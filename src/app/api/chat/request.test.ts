import { describe, expect, it } from "vitest";

import { parseChatRequest } from "~/app/api/chat/request";

const userMsg = (text: string, id?: string) => ({
  ...(id ? { id } : {}),
  role: "user" as const,
  parts: [{ type: "text", text }],
});

describe("parseChatRequest", () => {
  it("normalizes a valid body (message + threadId), extracting the query and id", () => {
    const r = parseChatRequest({ message: userMsg("hello", "m1"), threadId: "t1" });
    expect(r).toEqual({
      ok: true,
      request: { query: "hello", threadId: "t1", userMessageId: "m1" },
    });
  });

  it("ignores unknown chat-client envelope keys", () => {
    const r = parseChatRequest({
      message: userMsg("hi", "m1"),
      threadId: "t1",
      trigger: "submit-message",
      id: "t1",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a body missing its threadId", () => {
    expect(parseChatRequest({ message: userMsg("hi") }).ok).toBe(false);
  });

  it("rejects a body missing its message", () => {
    expect(parseChatRequest({ threadId: "t1" }).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseChatRequest(null).ok).toBe(false);
    expect(parseChatRequest("nope").ok).toBe(false);
  });

  it("rejects an empty or whitespace-only query", () => {
    expect(parseChatRequest({ message: userMsg("   "), threadId: "t1" }).ok).toBe(false);
  });
});
