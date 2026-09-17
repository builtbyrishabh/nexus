import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memory: {
    getThreadById: vi.fn(),
    listThreads: vi.fn(),
    recall: vi.fn(),
    updateThread: vi.fn(),
    deleteThread: vi.fn(),
  },
  toAISdkMessages: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("~/server/mastra", () => ({
  nexusMemory: mocks.memory,
  storage: {},
}));
vi.mock("@mastra/memory", () => ({
  Memory: class {
    constructor() {
      return mocks.memory;
    }
  },
}));
vi.mock("@mastra/ai-sdk/ui", () => ({
  toAISdkMessages: mocks.toAISdkMessages,
}));

const threads = await import("~/server/chat/threads");

describe("chat threads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports the ownership guard used by the chat route", async () => {
    mocks.memory.getThreadById.mockResolvedValue({
      id: "thread-1",
      resourceId: "another-user",
    });

    const assertThreadOwner = threads.assertThreadOwner as (
      threadId: string,
      userId: string,
    ) => Promise<unknown>;
    await expect(assertThreadOwner("thread-1", "user-1")).rejects.toMatchObject<
      Partial<TRPCError>
    >({ code: "NOT_FOUND" });
  });

  it("loads native AI SDK v7 messages through the shared memory instance", async () => {
    const storedMessages = [{ id: "stored-1" }];
    const uiMessages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-searchCreatorCatalog",
            state: "output-available",
            output: { evidence: [] },
          },
        ],
      },
    ];
    mocks.memory.getThreadById.mockResolvedValue({
      id: "thread-1",
      resourceId: "user-1",
    });
    mocks.memory.recall.mockResolvedValue({ messages: storedMessages });
    mocks.toAISdkMessages.mockReturnValue(uiMessages);

    await expect(threads.loadThreadMessages("thread-1", "user-1")).resolves.toEqual(
      uiMessages,
    );
    expect(mocks.memory.recall).toHaveBeenCalledWith({
      threadId: "thread-1",
      resourceId: "user-1",
      perPage: false,
    });
    expect(mocks.toAISdkMessages).toHaveBeenCalledWith(storedMessages, {
      version: "v7",
    });
  });
});
