import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContext } from "@mastra/core/request-context";
import { TRPCError } from "@trpc/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertThreadOwner: vi.fn(),
  createThread: vi.fn(),
  loadSourceLibrary: vi.fn(),
  handleChatStream: vi.fn(),
  createUIMessageStream: vi.fn(() => ({ legacy: true })),
  createUIMessageStreamResponse: vi.fn(() => new Response("stream")),
  stream: new ReadableStream(),
  mastra: { id: "mastra" },
  consumeDailyQuota: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@mastra/ai-sdk", () => ({ handleChatStream: mocks.handleChatStream }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    createUIMessageStream: mocks.createUIMessageStream,
    createUIMessageStreamResponse: mocks.createUIMessageStreamResponse,
  };
});
vi.mock("~/server/mastra", () => ({
  mastra: mocks.mastra,
  NEXUS_MAX_STEPS: 30,
}));
vi.mock("~/server/chat/threads", () => ({
  assertThreadOwner: mocks.assertThreadOwner,
  createThread: mocks.createThread,
}));
vi.mock("~/server/domain/source-library", () => ({
  loadSourceLibrary: mocks.loadSourceLibrary,
}));
vi.mock("~/server/usage-quota", () => ({
  consumeDailyQuota: mocks.consumeDailyQuota,
}));

const { POST } = await import("~/app/api/chat/route");

const threadId = "550e8400-e29b-41d4-a716-446655440000";
const message = {
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "What did the creator say?" }],
};

function request() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, threadId }),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.assertThreadOwner.mockResolvedValue(null);
    mocks.loadSourceLibrary.mockResolvedValue({
      hasSources: true,
      allowedCreators: [
        { handle: "alex", displayName: "Alex Hormozi" },
      ],
    });
    mocks.handleChatStream.mockResolvedValue(mocks.stream);
    mocks.consumeDailyQuota.mockResolvedValue(true);
  });

  it("authenticates ownership and delegates the native message to Mastra", async () => {
    const req = request();
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mocks.assertThreadOwner).toHaveBeenCalledWith(threadId, "user-1");
    expect(mocks.loadSourceLibrary).toHaveBeenCalledWith("user-1");
    expect(mocks.handleChatStream).toHaveBeenCalledWith({
      mastra: mocks.mastra,
      agentId: "nexus",
      version: "v7",
      params: {
        messages: [message],
        memory: { thread: threadId, resource: "user-1" },
        requestContext: expect.any(RequestContext),
        maxSteps: 30,
        abortSignal: req.signal,
      },
    });
    const call = mocks.handleChatStream.mock.calls[0]![0];
    const requestContext = call.params.requestContext as RequestContext;
    expect(requestContext.getRaw("userId")).toBe("user-1");
    expect(requestContext.getRaw("hasSources")).toBe(true);
    expect(requestContext.getRaw("allowedCreators")).toEqual([
      { handle: "alex", displayName: "Alex Hormozi" },
    ]);
    expect(mocks.createUIMessageStreamResponse).toHaveBeenCalledWith({
      stream: mocks.stream,
    });
  });

  it("seeds the new thread's title from the question on the first turn", async () => {
    await POST(request());

    expect(mocks.createThread).toHaveBeenCalledWith(
      threadId,
      "user-1",
      "What did the creator say?",
    );
  });

  it("does not re-title an existing thread", async () => {
    mocks.assertThreadOwner.mockResolvedValue({
      id: threadId,
      resourceId: "user-1",
    });

    await POST(request());

    expect(mocks.createThread).not.toHaveBeenCalled();
    expect(mocks.handleChatStream).toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before invoking the agent", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.assertThreadOwner).not.toHaveBeenCalled();
    expect(mocks.loadSourceLibrary).not.toHaveBeenCalled();
    expect(mocks.handleChatStream).not.toHaveBeenCalled();
  });

  it("returns not found for a thread owned by another user", async () => {
    mocks.assertThreadOwner.mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.loadSourceLibrary).not.toHaveBeenCalled();
    expect(mocks.handleChatStream).not.toHaveBeenCalled();
  });

  it("returns 429 before invoking paid work when the daily quota is exhausted", async () => {
    mocks.consumeDailyQuota.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.consumeDailyQuota).toHaveBeenCalledWith("user-1", "chat");
    expect(mocks.loadSourceLibrary).not.toHaveBeenCalled();
    expect(mocks.handleChatStream).not.toHaveBeenCalled();
  });
});
