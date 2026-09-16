import { isRefusal, refusalText } from "~/server/answer";
import { prepareAnswer } from "~/server/ask";
import { evidenceText, evidenceToCitations } from "~/server/domain/citations";
import { GOLDEN_SET, validateGolden, type GoldenCase } from "~/server/evals/golden";
import { scoreAnswer } from "~/server/evals/score";
import { summarize, type CaseResult, type EvalSummary } from "~/server/evals/summary";
import { nexusAgent } from "~/server/mastra";
import { env } from "~/env";
import { mapPool } from "~/server/util/pool";

const CASE_CONCURRENCY = 3;

const ZERO_SCORES = {
  faithfulness: 0,
  answerRelevancy: 0,
  contextPrecision: 0,
} as const;

/**
 * Run one golden case through the REAL query path: `prepareAnswer()` is the same function `ask()`
 * calls (same retrieve options, same refusal decision, same prompt), so the score reflects
 * production rather than a lookalike, and whatever Tier 2 adds to the path is graded automatically.
 * The only difference from `ask()` is the finish: a blocking generate instead of a stream.
 *
 * Grading follows the case kind, not the model's choice: expected-refusal cases carry the decision
 * only (`scores` absent); answerable cases are always scored — real judge scores when the model
 * answered, all-zero when it wrongly refused — so a wrongful refusal counts against the means
 * instead of quietly dropping out of them (see summary.ts).
 */
async function runCase(c: GoldenCase, rerank: boolean): Promise<CaseResult> {
  const { evidence, messages, creatorName } = await prepareAnswer(c.query, {
    rerank,
  });
  const answer = messages
    ? (await nexusAgent.generate(messages)).text
    : refusalText(creatorName);

  const refused = isRefusal(answer, creatorName);
  const scores = c.expectRefusal
    ? undefined
    : refused
      ? ZERO_SCORES
      : await scoreAnswer({
          query: c.query,
          answer,
          contextTexts: evidence.map(evidenceText),
        });

  return {
    id: c.id,
    expectRefusal: !!c.expectRefusal,
    refused,
    scores,
    answer,
    citations: evidenceToCitations(evidence).citations,
  };
}

/**
 * Run the whole golden set and summarize. `rerank` selects the retrieval variant under test, so
 * the caller can run the suite twice (off vs on) and read the lift off the two summaries — the
 * measured-not-asserted story for the reranker (docs/DESIGN.md §7). Left unset it grades the
 * product default (`env.RERANK_ENABLED`), passed explicitly so a provider failure fails the run.
 */
export async function runEvalSuite(opts?: {
  rerank?: boolean;
  cases?: GoldenCase[];
  concurrency?: number;
}): Promise<{ results: CaseResult[]; summary: EvalSummary }> {
  const cases = opts?.cases ?? GOLDEN_SET;
  validateGolden(cases);
  const rerank = opts?.rerank ?? env.RERANK_ENABLED;

  const results = await mapPool(cases, opts?.concurrency ?? CASE_CONCURRENCY, (c) =>
    runCase(c, rerank),
  );
  return { results, summary: summarize(results) };
}
