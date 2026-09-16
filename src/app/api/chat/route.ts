import { auth } from "@clerk/nextjs/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { parseChatRequest } from "~/app/api/chat/request";
import { ask } from "~/server/ask";
import { persistTurn, recallModelMessages } from "~/server/chat/threads";
import { creatorNameMap, listCreators } from "~/server/domain/roster";
import type { Citation } from "~/server/domain/types";
import type { NexusUIMessage } from "~/server/domain/ui";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * The single streaming query path. `parseChatRequest` validates the body into `{ message, threadId }`
 * (only the newest user message; prior turns are recalled server-side, never trusted from the client)
 * and the turn is persisted after it streams. Reduces to `ask()` (grounded, cited; multi-turn context,
 * single-turn retrieval). Auth is required: everything under the app shell is behind Clerk.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = parseChatRequest(await req.json().catch(() => null));
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });
  const { query, threadId, userMessageId } = parsed.request;

  // Server-owned scope: the collection = every creator actually ingested (derived from `source`, so a
  // newly ingested creator is searchable with no code change). The model can only narrow within it.
  const creators = await listCreators();
  const collectionCreatorHandles = creators.map((c) => c.handle);
  const creatorNames = creatorNameMap(creators);

  // Prior turns as plain context, recalled from the store — the client is never trusted with history.
  const history = await recallModelMessages(threadId, userId);

  const stream = createUIMessageStream<NexusUIMessage>({
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();
      let textStarted = false;
      let answer = "";
      let citations: Citation[] = [];

      for await (const chunk of ask({
        query,
        collectionCreatorHandles, // the searchable roster (server-owned, from ingested sources)
        creatorNames, // handle → display name, for single-creator refusal wording
        history, // recalled from the store; empty = single-turn
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

      // Best-effort: the answer has already streamed, so a store hiccup must never fail the response.
      try {
        await persistTurn({
          threadId,
          userId,
          question: query,
          answer,
          citations,
          userMessageId,
        });
      } catch (err) {
        console.error("[chat] failed to persist turn", err);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
