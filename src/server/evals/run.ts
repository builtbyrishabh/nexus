import { buildAnswerMessages, isRefusal, REFUSAL_TEXT } from "~/server/answer";
import { GOLDEN_SET, validateGolden, type GoldenCase } from "~/server/evals/golden";
import { scoreAnswer } from "~/server/evals/score";
import { summarize, type CaseResult, type EvalSummary } from "~/server/evals/summary";
import { nexusAgent } from "~/server/mastra";
import { retrieve } from "~/server/retrieval/retrieve";
import { mapPool } from "~/server/util/pool";

const TOP_K = 5;
const CASE_CONCURRENCY = 3;

const ZERO_SCORES = {
  faithfulness: 0,
  answerRelevancy: 0,
  contextPrecision: 0,
} as const;

/**
 * Run one golden case through the REAL query path — same retrieve() and same agent prompt that
 * `ask()` uses (via buildAnswerMessages) — so the score reflects production, not a lookalike.
 * Empty retrieval short-circuits to the refusal exactly as ask() does.
 *
 * Grading follows the case kind, not the model's choice: expected-refusal cases carry the decision
 * only (`scores` absent); answerable cases are always scored — real judge scores when the model
 * answered, all-zero when it wrongly refused — so a wrongful refusal counts against the means
 * instead of quietly dropping out of them (see summary.ts).
 */
async function runCase(c: GoldenCase, rerank: boolean): Promise<CaseResult> {
  const evidence = await retrieve(c.query, { topK: TOP_K, rerank });
  const answer =
    evidence.length === 0
      ? REFUSAL_TEXT
      : (await nexusAgent.generate(buildAnswerMessages(c.query, evidence))).text;

  const refused = isRefusal(answer);
  const scores = c.expectRefusal
    ? undefined
    : refused
      ? ZERO_SCORES
      : await scoreAnswer({
          query: c.query,
          answer,
          contextTexts: evidence.map((e) => e.text),
        });

  return { id: c.id, expectRefusal: !!c.expectRefusal, refused, scores };
}

/**
 * Run the whole golden set and summarize. `rerank` selects the retrieval variant under test, so
 * the caller can run the suite twice (off vs on) and read the lift off the two summaries — the
 * measured-not-asserted story for the reranker (docs/DESIGN.md §7).
 */
export async function runEvalSuite(opts?: {
  rerank?: boolean;
  cases?: GoldenCase[];
  concurrency?: number;
}): Promise<{ results: CaseResult[]; summary: EvalSummary }> {
  const cases = opts?.cases ?? GOLDEN_SET;
  validateGolden(cases);
  const rerank = opts?.rerank ?? false;

  const results = await mapPool(cases, opts?.concurrency ?? CASE_CONCURRENCY, (c) =>
    runCase(c, rerank),
  );
  return { results, summary: summarize(results) };
}
