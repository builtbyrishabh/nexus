import { auth } from "@clerk/nextjs/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { parseChatRequest } from "~/app/api/chat/request";
import { ask } from "~/server/ask";
import { persistTurn, recallModelMessages } from "~/server/chat/threads";
import { creatorNameMap, listCreators } from "~/server/domain/roster";
import { unknownHandles } from "~/server/domain/scope";
import type { Citation, HistoryMessage } from "~/server/domain/types";
import type { NexusUIMessage } from "~/server/domain/ui";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * The single streaming query path. `parseChatRequest` validates and normalizes the body into one of
 * two explicit shapes — a saved chat (`{ message, threadId }`, history recalled server-side and the
 * turn persisted) or a Panel column (`{ messages, creatorHandle }`, client-owned ephemeral history,
 * nothing saved). Both reduce to `ask()` (grounded, cited; multi-turn context, single-turn
 * retrieval). Auth is required for either: everything under the app shell is behind Clerk.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = parseChatRequest(await req.json().catch(() => null));
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });
  const request = parsed.request;

  // Server-owned scope. Collection = every creator actually ingested (derived from `source`, so a
  // newly ingested creator is searchable with no code change). A Panel column pins one creator as the
  // user's explicit selection; validate it against the collection here so an unknown/out-of-collection
  // handle is rejected, never silently broadened.
  const creators = await listCreators();
  const collectionCreatorHandles = creators.map((c) => c.handle);
  const creatorNames = creatorNameMap(creators);

  let selectedCreatorHandles: string[] | undefined;
  if (request.kind === "panel") {
    const bad = unknownHandles([request.creatorHandle], collectionCreatorHandles);
    if (bad.length > 0) {
      return new Response(`Unknown creator: ${request.creatorHandle}`, { status: 400 });
    }
    selectedCreatorHandles = [request.creatorHandle];
  }

  // Prior turns as plain context. Saved chat: recall from the store (never trust the client with
  // history). Panel: the client owns the ephemeral transcript, already normalized by the parser.
  const history: HistoryMessage[] =
    request.kind === "saved"
      ? await recallModelMessages(request.threadId, userId)
      : request.history;

  const stream = createUIMessageStream<NexusUIMessage>({
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();
      let textStarted = false;
      let answer = "";
      let citations: Citation[] = [];

      for await (const chunk of ask({
        query: request.query,
        collectionCreatorHandles, // the searchable roster (server-owned, from ingested sources)
        creatorNames, // handle → display name, for single-creator refusal wording
        selectedCreatorHandles, // set per column on /panel; absent on the saved chat
        history, // recalled (saved chat) or client-supplied (panel); empty = single-turn
        signal: req.signal, // client disconnect cancels generation
      })) {
        if (chunk.citations) {
          citations = chunk.citations;
          writer.write({ type: "data-citations", data: chunk.citations });
        }
        if (chunk.textDelta !== undefined) {
          if (!textStarted) {
            writer.write({ type: "text-start", id: textId });
            textStarted = true;
          }
          answer += chunk.textDelta;
          writer.write({
            type: "text-delta",
            id: textId,
            delta: chunk.textDelta,
          });
        }
      }

      if (textStarted) writer.write({ type: "text-end", id: textId });

      // Persist only the saved-chat turn — the Panel is ephemeral. Best-effort: the answer has
      // already streamed, so a store hiccup must never fail the response.
      if (request.kind === "saved") {
        try {
          await persistTurn({
            threadId: request.threadId,
            userId,
            question: request.query,
            answer,
            citations,
            userMessageId: request.userMessageId,
          });
        } catch (err) {
          console.error("[chat] failed to persist turn", err);
        }
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
