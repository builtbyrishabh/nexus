import { z } from "zod";

import type { HistoryMessage } from "~/server/domain/types";

/**
 * The `/api/chat` request contract. Two explicit shapes reach this one endpoint, and the ambiguity
 * that used to be *inferred* from which optional fields were present is now validated and normalized
 * here, once, before the answer path runs:
 *
 *   - saved chat  → `{ message, threadId }`     : only the newest user message; prior turns are
 *                                                  recalled server-side and the turn is persisted.
 *   - Panel column → `{ messages, creatorHandle }`: the full ephemeral per-column transcript,
 *                                                  scoped to one creator, nothing saved.
 *
 * A body that matches neither, both, or crosses the two (e.g. `message` + `creatorHandle`) is
 * rejected. Unknown envelope keys the chat client adds (`id`, `trigger`, …) are ignored.
 */

const uiPart = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const uiMessage = z.object({
  id: z.string().optional(),
  role: z.string().optional(),
  parts: z.array(uiPart),
});
type UiMessage = z.infer<typeof uiMessage>;

const bodySchema = z
  .object({
    message: uiMessage.optional(),
    messages: z.array(uiMessage).optional(),
    threadId: z.string().min(1).optional(),
    creatorHandle: z.string().min(1).optional(),
  })
  .passthrough();

/** The normalized request the route acts on — the query already extracted, the shape decided. */
export type ChatRequest =
  | { kind: "saved"; query: string; threadId: string; userMessageId?: string }
  | { kind: "panel"; query: string; history: HistoryMessage[]; creatorHandle: string };

export type ParseResult =
  | { ok: true; request: ChatRequest }
  | { ok: false; error: string };

/** The plain text of a UI message, concatenated from its text parts. */
function textOfMessage(message: UiMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

/** Validate and normalize a raw `/api/chat` body into one explicit request shape, or an error. */
export function parseChatRequest(body: unknown): ParseResult {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("Malformed request body");
  const { message, messages, threadId, creatorHandle } = parsed.data;

  const isSaved = message !== undefined;
  const isPanel = messages !== undefined;
  if (isSaved === isPanel) {
    return fail("Provide either a saved-chat or a Panel request, not both");
  }

  if (isSaved) {
    if (creatorHandle !== undefined) return fail("A saved-chat request cannot pin a creator");
    if (!threadId) return fail("A saved-chat request requires a threadId");
    const query = textOfMessage(message);
    if (!query) return fail("The message has no text");
    return { ok: true, request: { kind: "saved", query, threadId, userMessageId: message.id } };
  }

  // Panel.
  if (threadId !== undefined) return fail("A Panel request cannot carry a threadId");
  if (!creatorHandle) return fail("A Panel request requires a creatorHandle");
  if (!messages || messages.length === 0) return fail("The transcript is empty");
  const query = textOfMessage(messages[messages.length - 1]!);
  if (!query) return fail("The latest message has no text");
  const history: HistoryMessage[] = messages
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: textOfMessage(m),
    }))
    .filter((m) => m.content.length > 0);
  return { ok: true, request: { kind: "panel", query, history, creatorHandle } };
}
