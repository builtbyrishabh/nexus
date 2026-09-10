import { auth } from "@clerk/nextjs/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { ask } from "~/server/ask";
import { persistTurn } from "~/server/chat/threads";
import type { Citation } from "~/server/domain/types";
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
 * The single streaming query path, shared by two callers:
 *   - the main chat sends `{ message, threadId }` — only the newest user message (history lives
 *     in Mastra Memory) — and its turn is persisted for the sidebar.
 *   - the Panel sends `{ messages, creatorHandle }` — ephemeral, scoped to one creator, not saved.
 *
 * Both reduce to `ask()` (single-turn, grounded, cited). Auth is required for either: everything
 * under the app shell is behind Clerk.
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
        creatorHandle, // absent on the main chat (unscoped); set per column on /panel
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
