import { describe, expect, it } from "vitest";

import { parseChatRequest } from "~/app/api/chat/request";

const userMsg = (text: string, id?: string) => ({
  ...(id ? { id } : {}),
  role: "user" as const,
  parts: [{ type: "text", text }],
});
const assistantMsg = (text: string) => ({
  role: "assistant" as const,
  parts: [{ type: "text", text }],
});

describe("parseChatRequest", () => {
  it("normalizes a saved-chat body (message + threadId), extracting the query and id", () => {
    const r = parseChatRequest({ message: userMsg("hello", "m1"), threadId: "t1" });
    expect(r).toEqual({
      ok: true,
      request: { kind: "saved", query: "hello", threadId: "t1", userMessageId: "m1" },
    });
  });

  it("ignores unknown chat-client envelope keys on a saved body", () => {
    const r = parseChatRequest({
      message: userMsg("hi", "m1"),
      threadId: "t1",
      trigger: "submit-message",
      id: "t1",
    });
    expect(r.ok).toBe(true);
  });

  it("normalizes a Panel body (messages + creatorHandle), query = last message, history = the rest", () => {
    const r = parseChatRequest({
      messages: [userMsg("first"), assistantMsg("answer one"), userMsg("second")],
      creatorHandle: "hormozi",
    });
    expect(r).toEqual({
      ok: true,
      request: {
        kind: "panel",
        query: "second",
        creatorHandle: "hormozi",
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer one" },
        ],
      },
    });
  });

  it("rejects an ambiguous body carrying both message and messages", () => {
    const r = parseChatRequest({
      message: userMsg("a"),
      messages: [userMsg("b")],
      threadId: "t1",
      creatorHandle: "hormozi",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a body that is neither shape", () => {
    expect(parseChatRequest({}).ok).toBe(false);
    expect(parseChatRequest(null).ok).toBe(false);
    expect(parseChatRequest("nope").ok).toBe(false);
  });

  it("rejects a saved body missing its threadId", () => {
    expect(parseChatRequest({ message: userMsg("hi") }).ok).toBe(false);
  });

  it("rejects a Panel body missing its creatorHandle", () => {
    expect(parseChatRequest({ messages: [userMsg("hi")] }).ok).toBe(false);
  });

  it("rejects cross-contaminated shapes (saved with a creatorHandle, panel with a threadId)", () => {
    expect(
      parseChatRequest({ message: userMsg("hi"), threadId: "t1", creatorHandle: "x" }).ok,
    ).toBe(false);
    expect(
      parseChatRequest({ messages: [userMsg("hi")], creatorHandle: "x", threadId: "t1" }).ok,
    ).toBe(false);
  });

  it("rejects an empty or whitespace-only query", () => {
    expect(parseChatRequest({ message: userMsg("   "), threadId: "t1" }).ok).toBe(false);
    expect(
      parseChatRequest({ messages: [userMsg("  ")], creatorHandle: "hormozi" }).ok,
    ).toBe(false);
  });
});
