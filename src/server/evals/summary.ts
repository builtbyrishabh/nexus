/**
 * Eval aggregation + the tier gate. Pure and dependency-free: given per-case outcomes, it
 * computes the mean of each axis over the *answerable* cases, the refusal accuracy over *all*
 * cases, and whether the run clears the thresholds. "Don't advance a tier until its evals pass"
 * (docs/ARCHITECTURE.md) is exactly `summary.passed`. Kept free of model/DB imports so the gate
 * logic is unit-testable without touching the network.
 */

/** The three Tier-1 eval axes (docs canonical set). Each in [0, 1]. */
export type AxisScores = {
  faithfulness: number;
  answerRelevancy: number;
  contextPrecision: number;
};

/** One graded case. `scores` is absent for refusals (there is no prose to grade). */
export type CaseResult = {
  id: string;
  expectRefusal: boolean;
  refused: boolean;
  scores?: AxisScores;
};

export type EvalThresholds = AxisScores & { refusalAccuracy: number };

/** Canonical pass bars. Refusal accuracy is 1.0 — the refusal is the product; it must be exact. */
export const DEFAULT_THRESHOLDS: EvalThresholds = {
  faithfulness: 0.7,
  answerRelevancy: 0.7,
  contextPrecision: 0.6,
  refusalAccuracy: 1,
};

export type EvalSummary = {
  means: AxisScores;
  refusalAccuracy: number;
  scored: number; // answerable cases that were graded
  total: number;
  passed: boolean;
  failures: string[]; // axes (incl. "refusalAccuracy") that fell below threshold
};

const AXES = ["faithfulness", "answerRelevancy", "contextPrecision"] as const;

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * A refusal decision is correct when the model refused exactly on the out-of-corpus cases:
 * `refused === expectRefusal`. This catches both failure modes — answering when it should have
 * refused (hallucination risk) and refusing when the corpus covered it (lost coverage).
 */
export function summarize(
  results: CaseResult[],
  thresholds: EvalThresholds = DEFAULT_THRESHOLDS,
): EvalSummary {
  const graded = results.filter((r) => r.scores !== undefined);
  const means: AxisScores = {
    faithfulness: mean(graded.map((r) => r.scores!.faithfulness)),
    answerRelevancy: mean(graded.map((r) => r.scores!.answerRelevancy)),
    contextPrecision: mean(graded.map((r) => r.scores!.contextPrecision)),
  };

  const refusalAccuracy =
    results.length === 0
      ? 0
      : results.filter((r) => r.refused === r.expectRefusal).length /
        results.length;

  const failures: string[] = [];
  for (const axis of AXES) {
    if (means[axis] < thresholds[axis]) failures.push(axis);
  }
  if (refusalAccuracy < thresholds.refusalAccuracy) failures.push("refusalAccuracy");

  return {
    means,
    refusalAccuracy,
    scored: graded.length,
    total: results.length,
    passed: failures.length === 0,
    failures,
  };
}
