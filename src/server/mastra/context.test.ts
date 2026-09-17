import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, expect, it, vi } from "vitest";

import { citationRegistry } from "~/app/_components/answer";

vi.mock("~/env", () => ({
  env: { DATABASE_URL: "postgresql://unused", GEN_MODEL: "test/model" },
}));
vi.mock("@mastra/pg", async () => {
  const { InMemoryStore } = await import("@mastra/core/storage");
  return { PostgresStore: InMemoryStore };
});
vi.mock("~/server/retrieval/retrieve", () => ({
  retrieve: async () => [{
    chunkId: "chunk-1",
    sourceId: "source-1",
    score: 0.9,
    text: "Unique retrieved passage.",
    source: { title: "Pricing", url: "https://youtu.be/abc" },
    locator: { startSec: 65, endSec: 90 },
  }],
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: () => model,
}));

let searchNext = true;
const model = new MockLanguageModelV3({
  doStream: async () => {
    const search = searchNext;
    searchNext = false;
    const stream: Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] =
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (search) {
            controller.enqueue({
              type: "tool-call", toolCallId: "call-1",
              toolName: "searchCreatorCatalog", input: '{"query":"pricing"}',
            });
          } else {
            controller.enqueue({ type: "text-start", id: "text" });
            controller.enqueue({
              type: "text-delta", id: "text", delta: "Supported answer [cite:chunk-1].",
            });
            controller.enqueue({ type: "text-end", id: "text" });
          }
          controller.enqueue({
            type: "finish",
            finishReason: { unified: search ? "tool-calls" : "stop", raw: undefined },
            usage: {
              inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          });
          controller.close();
        },
      });
    return { stream };
  },
});
const { nexusAgent, nexusMemory } = await import("~/server/mastra");

beforeEach(() => {
  searchNext = true;
  model.doStreamCalls.length = 0;
});

it("keeps current evidence compact, filters old searches, and restores full citations", async () => {
  const memory = {
    thread: { id: "context-test", title: "Pricing question" },
    resource: "user",
  };
  await (await nexusAgent.stream("What is the pricing advice?", { memory, maxSteps: 3 })).consumeStream();

  expect(model.doStreamCalls).toHaveLength(2);
  expect((await nexusMemory.getThreadById({ threadId: "context-test" }))?.title)
    .toBe("Pricing question");
  const answerPrompt = JSON.stringify(model.doStreamCalls[1]!.prompt);
  expect(answerPrompt).toContain("Unique retrieved passage.");
  expect(answerPrompt).toContain("chunk-1");
  expect(answerPrompt).not.toContain("https://youtu.be/abc");
  expect(answerPrompt).not.toContain("startSec");

  const firstTurnCalls = model.doStreamCalls.length;
  await nexusMemory.updateThread({ id: "context-test", title: "My renamed chat" });
  await (await nexusAgent.stream("Explain your previous answer.", { memory, maxSteps: 3 })).consumeStream();
  const followupPrompt = JSON.stringify(model.doStreamCalls[firstTurnCalls]!.prompt);
  expect(followupPrompt).toContain("Supported answer [cite:chunk-1].");
  expect(followupPrompt).not.toContain("Unique retrieved passage.");
  expect((await nexusMemory.getThreadById({ threadId: "context-test" }))?.title)
    .toBe("My renamed chat");

  const { messages } = await nexusMemory.recall({
    threadId: "context-test", resourceId: "user", perPage: false,
  });
  const ui = toAISdkMessages(messages, { version: "v7" });
  expect(citationRegistry(ui).get("chunk-1")).toMatchObject({
    url: "https://youtu.be/abc?t=65", timestamp: "1:05", startSec: 65,
  });
});

it("bounds model recall while leaving the full conversation stored", async () => {
  await nexusMemory.createThread({
    threadId: "long-thread", resourceId: "user", title: "Long conversation",
  });
  await nexusMemory.saveMessages({
    messages: Array.from({ length: 30 }, (_, index) => ({
      id: `old-${index}`,
      threadId: "long-thread",
      resourceId: "user",
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      createdAt: new Date(1_700_000_000_000 + index),
      content: {
        format: 2 as const,
        parts: [{ type: "text" as const, text: `History entry ${index}.` }],
      },
    })),
  });
  searchNext = false;
  await (await nexusAgent.stream("Continue.", {
    memory: { thread: "long-thread", resource: "user" },
  })).consumeStream();
  const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
  expect(prompt).not.toContain("History entry 0.");
  expect(prompt).toContain("History entry 29.");
  const { messages } = await nexusMemory.recall({ threadId: "long-thread", perPage: false });
  expect(messages.some((message) => message.id === "old-0")).toBe(true);
});
