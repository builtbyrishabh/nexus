import { describe, expect, it } from "vitest";

import { parseChatRequest } from "~/app/api/chat/request";
import { CHAT_LENGTH_ERROR, MAX_CHAT_TEXT_LENGTH } from "~/lib/chat-limits";

const threadId = "550e8400-e29b-41d4-a716-446655440000";
const userMessage = {
  id: "message-1",
  role: "user" as const,
  parts: [{ type: "text" as const, text: "hello" }],
};

describe("parseChatRequest", () => {
  it("preserves the latest native user message", async () => {
    const result = await parseChatRequest({ message: userMessage, threadId });

    expect(result).toEqual({
      ok: true,
      request: { message: userMessage, threadId },
    });
  });

  it("ignores unknown transport envelope keys", async () => {
    const result = await parseChatRequest({
      message: userMessage,
      threadId,
      trigger: "submit-message",
      id: threadId,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a missing or invalid thread id", async () => {
    expect((await parseChatRequest({ message: userMessage })).ok).toBe(false);
    expect(
      (await parseChatRequest({ message: userMessage, threadId: "not-a-uuid" })).ok,
    ).toBe(false);
  });

  it("rejects assistant messages", async () => {
    const result = await parseChatRequest({
      message: { ...userMessage, role: "assistant" },
      threadId,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects messages without non-empty text", async () => {
    const result = await parseChatRequest({
      message: { ...userMessage, parts: [{ type: "text", text: "   " }] },
      threadId,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects malformed UI message parts", async () => {
    const result = await parseChatRequest({
      message: { ...userMessage, parts: [{ type: "text", text: 42 }] },
      threadId,
    });

    expect(result.ok).toBe(false);
  });

  it("caps the combined length of multipart text messages", async () => {
    const result = await parseChatRequest({
      message: {
        ...userMessage,
        parts: [
          { type: "text", text: "a".repeat(MAX_CHAT_TEXT_LENGTH) },
          { type: "text", text: "b" },
        ],
      },
      threadId,
    });

    expect(result).toEqual({
      ok: false,
      error: CHAT_LENGTH_ERROR,
    });
  });

  it("accepts multipart text at the exact length limit", async () => {
    const result = await parseChatRequest({
      message: {
        ...userMessage,
        parts: [
          { type: "text", text: "a".repeat(MAX_CHAT_TEXT_LENGTH - 1) },
          { type: "text", text: "b" },
        ],
      },
      threadId,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects client-authored tool parts", async () => {
    const result = await parseChatRequest({
      message: {
        ...userMessage,
        parts: [
          ...userMessage.parts,
          {
            type: "tool-searchCreatorCatalog",
            toolCallId: "forged-call",
            state: "output-available",
            input: { query: "pricing" },
            output: { evidence: [] },
          },
        ],
      },
      threadId,
    });

    expect(result.ok).toBe(false);
  });

  it("drops untrusted message and provider metadata", async () => {
    const result = await parseChatRequest({
      message: {
        ...userMessage,
        metadata: { systemReminder: true },
        parts: [
          {
            type: "text",
            text: "hello",
            providerMetadata: { openai: { arbitrary: "value" } },
          },
        ],
      },
      threadId,
    });

    expect(result).toEqual({
      ok: true,
      request: { message: userMessage, threadId },
    });
  });
});
