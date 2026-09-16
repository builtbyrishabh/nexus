import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertThreadOwner: vi.fn(),
  handleChatStream: vi.fn(),
  createUIMessageStream: vi.fn(() => ({ legacy: true })),
  createUIMessageStreamResponse: vi.fn(() => new Response("stream")),
  stream: new ReadableStream(),
  mastra: { id: "mastra" },
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
    mocks.handleChatStream.mockResolvedValue(mocks.stream);
  });

  it("authenticates ownership and delegates the native message to Mastra", async () => {
    const req = request();
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mocks.assertThreadOwner).toHaveBeenCalledWith(threadId, "user-1");
    expect(mocks.handleChatStream).toHaveBeenCalledWith({
      mastra: mocks.mastra,
      agentId: "nexus",
      version: "v7",
      params: {
        messages: [message],
        memory: { thread: threadId, resource: "user-1" },
        maxSteps: 30,
        abortSignal: req.signal,
      },
    });
    expect(mocks.createUIMessageStreamResponse).toHaveBeenCalledWith({
      stream: mocks.stream,
    });
  });

  it("rejects unauthenticated requests before invoking the agent", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.assertThreadOwner).not.toHaveBeenCalled();
    expect(mocks.handleChatStream).not.toHaveBeenCalled();
  });
});
