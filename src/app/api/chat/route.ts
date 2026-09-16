import { auth } from "@clerk/nextjs/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { ask } from "~/server/ask";
import { persistTurn, recallModelMessages } from "~/server/chat/threads";
import { DEFAULT_COLLECTION } from "~/server/domain/creators";
import { unknownHandles } from "~/server/domain/scope";
import type { Citation, HistoryMessage } from "~/server/domain/types";
import type { NexusUIMessage } from "~/server/domain/ui";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** The plain text of a UI message, concatenated from its text parts. */
function textOfMessage(message: NexusUIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * The single streaming query path, shared by two callers, each supplying conversation history a
 * different way:
 *   - the main chat sends `{ message, threadId }` — only the newest user message; prior turns are
 *     recalled server-side from the store (keyed by threadId) — and its turn is persisted.
 *   - the Panel sends `{ messages, creatorHandle }` — the full per-column transcript, ephemeral
 *     and scoped to one creator; prior turns come straight off the request, nothing is saved.
 *
 * Both reduce to `ask()` (grounded, cited; multi-turn context, single-turn retrieval). Auth is
 * required for either: everything under the app shell is behind Clerk.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const {
    message,
    messages,
    threadId,
    creatorHandle,
  }: {
    message?: NexusUIMessage;
    messages?: NexusUIMessage[];
    threadId?: string;
    creatorHandle?: string;
  } = await req.json();

  const query = message
    ? textOfMessage(message)
    : textOfMessage(messages?.[messages.length - 1]);

  // Server-owned scope. Collection = the configured default roster (saved interests come later).
  // A Panel column pins one creator as the user's explicit selection; validate it against the
  // collection here so an unknown/out-of-collection handle is rejected, never silently broadened.
  const collectionCreatorHandles = [...DEFAULT_COLLECTION];
  let selectedCreatorHandles: string[] | undefined;
  if (creatorHandle) {
    const bad = unknownHandles([creatorHandle], collectionCreatorHandles);
    if (bad.length > 0) {
      return new Response(`Unknown creator: ${creatorHandle}`, { status: 400 });
    }
    selectedCreatorHandles = [creatorHandle];
  }

  // Prior turns as plain context. Main chat: recall from the store (never trust the client with
  // history). Panel: the client owns the ephemeral transcript, so take all but the newest message.
  let history: HistoryMessage[] = [];
  if (message && threadId) {
    history = await recallModelMessages(threadId, userId);
  } else if (messages && messages.length > 1) {
    history = messages
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: textOfMessage(m),
      }))
      .filter((m) => m.content.length > 0);
  }

  const stream = createUIMessageStream<NexusUIMessage>({
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();
      let textStarted = false;
      let answer = "";
      let citations: Citation[] = [];

      for await (const chunk of ask({
        query,
        channel: "web",
        userId,
        threadId: threadId ?? `web:${userId}`,
        collectionCreatorHandles, // the searchable roster (server-owned)
        selectedCreatorHandles, // set per column on /panel; absent on the main chat
        history, // recalled (main chat) or client-supplied (panel); empty = single-turn
        signal: req.signal, // client disconnect cancels generation
      })) {
        if (chunk.citations) {
          citations = chunk.citations;
          writer.write({ type: "data-citations", data: chunk.citations });
        }
        if (chunk.sources) {
          writer.write({ type: "data-sources", data: chunk.sources });
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

      // Persist only the threaded main-chat turn — the Panel is ephemeral. Best-effort: the answer
      // has already streamed, so a store hiccup must never fail the response.
      if (threadId && query) {
        try {
          await persistTurn({
            threadId,
            userId,
            question: query,
            answer,
            citations,
            userMessageId: message?.id,
          });
        } catch (err) {
          console.error("[chat] failed to persist turn", err);
        }
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
