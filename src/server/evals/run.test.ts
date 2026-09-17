import { beforeEach, describe, expect, it, vi } from "vitest";

const citation = {
  citationId: "chunk-1",
  text: "Catalog evidence",
  title: "Example video",
  url: "https://youtu.be/abc?t=15",
  startSec: 15,
  timestamp: "0:15",
};

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  loadSourceLibrary: vi.fn(),
  scoreAnswer: vi.fn(),
  assessUnsupportedAnswer: vi.fn(),
}));

vi.mock("~/server/mastra", () => ({
  nexusAgent: { generate: mocks.generate },
  NEXUS_MAX_STEPS: 30,
}));
vi.mock("~/server/evals/score", () => ({
  scoreAnswer: mocks.scoreAnswer,
  assessUnsupportedAnswer: mocks.assessUnsupportedAnswer,
}));
vi.mock("~/server/domain/source-library", () => ({
  loadSourceLibrary: mocks.loadSourceLibrary,
}));

const { runEvalSuite } = await import("~/server/evals/run");

describe("runEvalSuite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSourceLibrary.mockResolvedValue({
      hasSources: true,
      allowedCreators: [
        { handle: "alex", displayName: "Alex Hormozi" },
      ],
    });
    mocks.generate.mockImplementation(async (messages: Array<{ content: string }>) => ({
      text:
        messages.at(-1)?.content === "unsupported"
          ? "The catalog does not provide enough evidence."
          : "A grounded answer [cite:chunk-1].",
      toolResults: [
        {
          type: "tool-result",
          payload: {
            toolCallId: "call-1",
            toolName: "searchCreatorCatalog",
            result: { evidence: [citation] },
          },
        },
      ],
    }));
    mocks.assessUnsupportedAnswer.mockImplementation(
      async ({ answer }: { answer: string }) => answer.startsWith("The catalog"),
    );
    mocks.scoreAnswer.mockResolvedValue({
      faithfulness: 0.9,
      answerRelevancy: 0.9,
      contextPrecision: 0.9,
    });
  });

  it("runs the registered production agent and reads its structured tool results", async () => {
    const history = [{ role: "user" as const, content: "earlier context" }];
    const { results } = await runEvalSuite({
      userId: "eval-user",
      concurrency: 1,
      cases: [
        { id: "answer", query: "answerable", history },
        { id: "refusal", query: "unsupported", expectRefusal: true },
      ],
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      [...history, { role: "user", content: "answerable" }],
      {
        maxSteps: 30,
        requestContext: expect.anything(),
      },
    );
    const requestContext = mocks.generate.mock.calls[0]![1].requestContext;
    expect(requestContext.get("userId")).toBe("eval-user");
    expect(requestContext.get("hasSources")).toBe(true);
    expect(requestContext.get("allowedCreators")).toEqual([
      { handle: "alex", displayName: "Alex Hormozi" },
    ]);
    expect(results[0]?.citations).toEqual([citation]);
    expect(results[0]?.citationsValid).toBe(true);
    expect(results.map((result) => result.refused)).toEqual([false, true]);
  });

  it("fails the run when an answer cites evidence that was not returned", async () => {
    mocks.generate.mockResolvedValue({
      text: "A grounded-sounding answer [cite:missing].",
      toolResults: [
        {
          payload: {
            toolName: "searchCreatorCatalog",
            result: { evidence: [citation] },
          },
        },
      ],
    });
    mocks.assessUnsupportedAnswer.mockResolvedValue(false);

    const { results, summary } = await runEvalSuite({
      userId: "eval-user",
      concurrency: 1,
      cases: [
        { id: "bad-citation", query: "answerable" },
        { id: "refusal", query: "unsupported", expectRefusal: true },
      ],
    });

    expect(results[0]?.citationsValid).toBe(false);
    expect(summary.failures).toContain("citationAccuracy");
    expect(summary.passed).toBe(false);
  });
});
