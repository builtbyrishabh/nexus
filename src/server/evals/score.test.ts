import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  gateway: vi.fn(() => ({ modelId: "judge" })),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mocks.generateText,
    gateway: mocks.gateway,
  };
});

const { assessUnsupportedAnswer } = await import("~/server/evals/score");

describe("assessUnsupportedAnswer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a paraphrased response that declines an unsupported claim", async () => {
    mocks.generateText.mockResolvedValue({
      output: { declinedUnsupportedClaim: true },
    });

    await expect(
      assessUnsupportedAnswer({
        query: "What is the creator's morning routine?",
        answer: "I couldn't find enough in the catalog to support that.",
        contextTexts: [],
      }),
    ).resolves.toBe(true);
  });

  it("rejects an answer that invents a claim when evidence is empty", async () => {
    mocks.generateText.mockResolvedValue({
      output: { declinedUnsupportedClaim: false },
    });

    await expect(
      assessUnsupportedAnswer({
        query: "What is the creator's morning routine?",
        answer: "They wake up at 5 a.m. and meditate.",
        contextTexts: [],
      }),
    ).resolves.toBe(false);
  });
});
