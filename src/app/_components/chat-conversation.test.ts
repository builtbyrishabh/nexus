import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatStatus, UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({
  messages: [] as UIMessage[],
  status: "ready" as ChatStatus,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  error: undefined,
}));
vi.mock("@ai-sdk/react", () => ({ useChat: () => chat }));
vi.mock("~/trpc/react", () => ({ api: { useUtils: () => ({}) } }));

import { ChatConversation } from "~/app/_components/chat-conversation";

function render() {
  return renderToStaticMarkup(
    createElement(ChatConversation, { threadId: "thread", initialMessages: [] }),
  );
}

const search: UIMessage = {
  id: "assistant",
  role: "assistant",
  parts: [{
    type: "tool-searchCreatorCatalog",
    toolCallId: "call",
    state: "input-available",
    input: { query: "pricing" },
  }],
};

describe("chat progress", () => {
  beforeEach(() => {
    chat.messages = [search];
    chat.status = "streaming";
  });

  it("shows progress instead of an empty answer during catalog searches", () => {
    const html = render();
    expect(html).toContain("Thinking…");
    expect(html).not.toContain("whitespace-pre-wrap leading-relaxed");
  });

  it("keeps progress visible when the model searches after a text preamble", () => {
    chat.messages = [{
      ...search,
      parts: [{ type: "text", text: "Let me check." }, ...search.parts],
    }];
    const html = render();
    expect(html).toContain("Let me check.");
    expect(html).toContain("Thinking…");
  });

  it("does not leave a progress indicator after the run finishes", () => {
    chat.status = "ready";
    chat.messages = [{
      id: "answer", role: "assistant",
      parts: [{ type: "text", text: "The answer." }],
    }];
    expect(render()).not.toContain("Thinking…");
    expect(render()).toContain("The answer.");
  });
});
