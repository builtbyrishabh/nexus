import { isRefusal } from "~/server/answer";
import { buildScopedRun, finalizeText } from "~/server/ask";
import { evidenceText, evidenceToCitations } from "~/server/domain/citations";
import { creatorNameMap, listCreators } from "~/server/domain/roster";
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

/** The creator a scoped case refuses as (single selection → their name), for the refusal check. */
function caseCreatorName(
  c: GoldenCase,
  names: Record<string, string>,
): string | undefined {
  const handle = c.selected?.length === 1 ? c.selected[0] : undefined;
  return handle ? names[handle] : undefined;
}

/**
 * Run one golden case through the REAL production path: `buildScopedRun` + `finalizeText` are the
 * exact orchestration `ask()` streams — same agent, same `searchCreatorCatalog` tool, same scope,
 * same phase control — so the score reflects production, not a lookalike. The only difference is the
 * finish: a blocking `generate` instead of a stream. Evidence for scoring comes off the tool's
 * capture, i.e. exactly what the model was shown.
 *
 * Grading follows the case kind, not the model's choice: expected-refusal cases carry the decision
 * only (`scores` absent); answerable cases are always scored — real judge scores when the model
 * answered, all-zero when it wrongly refused — so a wrongful refusal counts against the means
 * instead of quietly dropping out of them (see summary.ts).
 */
async function runCase(
  c: GoldenCase,
  rerank: boolean,
  collection: string[],
  names: Record<string, string>,
): Promise<CaseResult> {
  const run = buildScopedRun({
    query: c.query,
    channel: "web",
    userId: "eval",
    threadId: "eval",
    collectionCreatorHandles: c.collection ?? collection,
    creatorNames: names,
    selectedCreatorHandles: c.selected,
    history: c.history,
    rerank,
  });
  const { text } = await nexusAgent.generate(run.messages, run.options);
  const answer = finalizeText(run.capture, text, names);
  const evidence = run.capture.evidence ?? [];

  const refused = isRefusal(answer, caseCreatorName(c, names));
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

  // Resolve the roster once: the default collection + handle→name map every case shares.
  const creators = await listCreators();
  const collection = creators.map((c) => c.handle);
  const names = creatorNameMap(creators);

  const results = await mapPool(cases, opts?.concurrency ?? CASE_CONCURRENCY, (c) =>
    runCase(c, rerank, collection, names),
  );
  return { results, summary: summarize(results) };
}
