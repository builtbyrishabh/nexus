/**
 * Eval aggregation + the tier gate. Pure and dependency-free: given per-case outcomes, it
 * computes the mean of each axis over the *answerable* cases, the refusal accuracy over *all*
 * cases, and whether the run clears the thresholds. "Don't advance a tier until its evals pass"
 * (docs/ARCHITECTURE.md) is exactly `summary.passed`. Kept free of model/DB imports so the gate
 * logic is unit-testable without touching the network.
 */

import type { Citation } from "~/server/domain/types";

/** The three Tier-1 eval axes (docs canonical set). Each in [0, 1]. */
export type AxisScores = {
  faithfulness: number;
  answerRelevancy: number;
  contextPrecision: number;
};

/**
 * The axes as data: key (into `AxisScores`/`EvalThresholds`) + display label. One table drives the
 * means, the failure check, and the CLI printers, so adding a fourth axis is a single edit here
 * rather than five scattered spots.
 */
export const AXES = [
  { key: "faithfulness", label: "faithfulness" },
  { key: "answerRelevancy", label: "answer relevancy" },
  { key: "contextPrecision", label: "context precision" },
] as const satisfies readonly { key: keyof AxisScores; label: string }[];

/**
 * One graded case. `scores` is present for every *answerable* case — real judge scores when the
 * model answered, all-zero when it wrongly refused (a refusal on an answerable case is a failure,
 * not an un-graded case) — and absent for expected-refusal cases, which are graded by the decision
 * alone.
 */
export type CaseResult = {
  id: string;
  expectRefusal: boolean;
  refused: boolean;
  scores?: AxisScores;
  /** What the model said and what it was shown — for `--verbose` inspection; the gate ignores both. */
  answer?: string;
  citations?: Citation[];
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
  scored: number; // answerable cases (the denominator of the axis means)
  total: number;
  passed: boolean;
  failures: string[]; // axes (incl. "refusalAccuracy") that fell below threshold
};

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Means are taken over the *answerable* cases (`!expectRefusal`), not "cases the model chose to
 * answer" — otherwise a wrongful refusal silently drops out of the denominator and a model that
 * refuses everything but one lucky case scores 100%. A wrongful refusal on an answerable case
 * carries all-zero scores (see `runCase`), so it drags the mean exactly as a bad answer would.
 *
 * A refusal decision is correct when the model refused exactly on the out-of-corpus cases:
 * `refused === expectRefusal`. This catches both failure modes — answering when it should have
 * refused (hallucination risk) and refusing when the corpus covered it (lost coverage).
 */
export function summarize(
  results: CaseResult[],
  thresholds: EvalThresholds = DEFAULT_THRESHOLDS,
): EvalSummary {
  const answerable = results.filter((r) => !r.expectRefusal);
  const means = Object.fromEntries(
    AXES.map((a) => [a.key, mean(answerable.map((r) => r.scores?.[a.key] ?? 0))]),
  ) as AxisScores;

  const refusalAccuracy =
    results.length === 0
      ? 0
      : results.filter((r) => r.refused === r.expectRefusal).length /
        results.length;

  const failures: string[] = [];
  for (const a of AXES) {
    if (means[a.key] < thresholds[a.key]) failures.push(a.key);
  }
  if (refusalAccuracy < thresholds.refusalAccuracy) failures.push("refusalAccuracy");

  return {
    means,
    refusalAccuracy,
    scored: answerable.length,
    total: results.length,
    passed: failures.length === 0,
    failures,
  };
}
