import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLDS,
  summarize,
  type CaseResult,
} from "~/server/evals/summary";

const answered = (
  id: string,
  faithfulness: number,
  answerRelevancy: number,
  contextPrecision: number,
): CaseResult => ({
  id,
  expectRefusal: false,
  refused: false,
  scores: { faithfulness, answerRelevancy, contextPrecision },
});

const refusalCase = (id: string, refused: boolean): CaseResult => ({
  id,
  expectRefusal: true,
  refused,
});

describe("summarize", () => {
  it("averages axes over graded cases only and passes when all bars are cleared", () => {
    const s = summarize([
      answered("a", 0.9, 0.9, 0.8),
      answered("b", 0.7, 0.7, 0.6),
      refusalCase("r", true),
    ]);

    expect(s.means.faithfulness).toBeCloseTo(0.8);
    expect(s.means.answerRelevancy).toBeCloseTo(0.8);
    expect(s.means.contextPrecision).toBeCloseTo(0.7);
    expect(s.scored).toBe(2); // the refusal is not graded
    expect(s.total).toBe(3);
    expect(s.refusalAccuracy).toBe(1);
    expect(s.passed).toBe(true);
    expect(s.failures).toEqual([]);
  });

  it("fails and names the axis when a mean is below threshold", () => {
    const s = summarize([
      answered("a", 0.9, 0.9, 0.3), // context precision drags the mean under 0.6
      answered("b", 0.9, 0.9, 0.3),
      refusalCase("r", true),
    ]);
    expect(s.passed).toBe(false);
    expect(s.failures).toContain("contextPrecision");
    expect(s.failures).not.toContain("faithfulness");
  });

  it("penalizes both refusal failure modes: answering when it should refuse, and vice versa", () => {
    const s = summarize([
      answered("a", 0.9, 0.9, 0.9),
      refusalCase("should-refuse-but-answered", false),
      { id: "should-answer-but-refused", expectRefusal: false, refused: true },
    ]);
    // 1 of 3 refusal decisions correct → 0.333, below the 1.0 bar.
    expect(s.refusalAccuracy).toBeCloseTo(1 / 3);
    expect(s.failures).toContain("refusalAccuracy");
    expect(s.passed).toBe(false);
  });

  it("does not divide by zero when every case is a refusal", () => {
    const s = summarize([refusalCase("r1", true), refusalCase("r2", true)]);
    expect(s.means).toEqual({
      faithfulness: 0,
      answerRelevancy: 0,
      contextPrecision: 0,
    });
    expect(s.refusalAccuracy).toBe(1);
    expect(s.scored).toBe(0);
  });

  it("uses the canonical thresholds by default", () => {
    expect(DEFAULT_THRESHOLDS.refusalAccuracy).toBe(1);
  });
});
