import { safeValidateUIMessages, type UIMessage } from "ai";
import { z } from "zod";

import { CHAT_LENGTH_ERROR, MAX_CHAT_TEXT_LENGTH } from "~/lib/chat-limits";

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
  if (!message || message.role !== "user") {
    return { ok: false, error: "The request must contain a user text message" };
  }

  const textParts = message.parts.flatMap((part) =>
    part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
  );
  if (
    textParts.length !== message.parts.length ||
    !textParts.some((part) => part.text.trim().length > 0)
  ) {
    return { ok: false, error: "The request must contain a user text message" };
  }
  if (textParts.reduce((length, part) => length + part.text.length, 0) > MAX_CHAT_TEXT_LENGTH) {
    return { ok: false, error: CHAT_LENGTH_ERROR };
  }

  return {
    ok: true,
    request: {
      message: {
        id: message.id,
        role: "user",
        parts: textParts,
      },
      threadId: parsed.data.threadId,
    },
  };
}
