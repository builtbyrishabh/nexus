import { describe, expect, it } from "vitest";

import { parseChatRequest } from "~/app/api/chat/request";

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
});
