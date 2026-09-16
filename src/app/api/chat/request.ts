import { safeValidateUIMessages, type UIMessage } from "ai";
import { z } from "zod";

const bodySchema = z
  .object({
    message: z.unknown(),
    threadId: z.string().uuid(),
  })
  .passthrough();

export type ChatRequest = { message: UIMessage; threadId: string };

export type ParseResult =
  | { ok: true; request: ChatRequest }
  | { ok: false; error: string };

/** Validate the transport envelope and preserve its native AI SDK user message. */
export async function parseChatRequest(body: unknown): Promise<ParseResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Malformed request body" };

  const validated = await safeValidateUIMessages({
    messages: [parsed.data.message],
  });
  if (!validated.success) return { ok: false, error: "Malformed message" };

  const message = validated.data[0];
  if (
    !message ||
    message.role !== "user" ||
    !message.parts.some(
      (part) => part.type === "text" && part.text.trim().length > 0,
    )
  ) {
    return { ok: false, error: "The request must contain a user text message" };
  }

  return {
    ok: true,
    request: { message, threadId: parsed.data.threadId },
  };
}
