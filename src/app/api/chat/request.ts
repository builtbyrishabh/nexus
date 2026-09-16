import { z } from "zod";

/**
 * The `/api/chat` request contract. The web client sends only the newest user message plus the
 * thread id — prior turns are recalled server-side, never trusted from the client. This validates
 * that untrusted body once and extracts the query, so the route never casts `req.json()` blind.
 */

const uiPart = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const uiMessage = z.object({
  id: z.string().optional(),
  role: z.string().optional(),
  parts: z.array(uiPart),
});

// `.passthrough()` tolerates the chat client's envelope keys (id, trigger, …) without failing.
const bodySchema = z
  .object({
    message: uiMessage,
    threadId: z.string().min(1),
  })
  .passthrough();

/** The normalized request the route acts on — query already extracted. */
export type ChatRequest = { query: string; threadId: string; userMessageId?: string };

export type ParseResult =
  | { ok: true; request: ChatRequest }
  | { ok: false; error: string };

/** Validate and normalize a raw `/api/chat` body, or return an error to answer with a 400. */
export function parseChatRequest(body: unknown): ParseResult {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Malformed request body" };
  const { message, threadId } = parsed.data;
  const query = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .trim();
  if (!query) return { ok: false, error: "The message has no text" };
  return { ok: true, request: { query, threadId, userMessageId: message.id } };
}
