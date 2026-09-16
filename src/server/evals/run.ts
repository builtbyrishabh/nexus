import type { ModelMessage } from "ai";
import pMap from "p-map";

import {
  catalogSearchResultSchema,
  type CatalogEvidence,
} from "~/server/domain/citations";
import { GOLDEN_SET, validateGolden, type GoldenCase } from "~/server/evals/golden";
import {
  assessUnsupportedAnswer,
  scoreAnswer,
} from "~/server/evals/score";
import {
  summarize,
  type CaseResult,
  type EvalSummary,
} from "~/server/evals/summary";
import { nexusAgent, NEXUS_MAX_STEPS } from "~/server/mastra";

const CASE_CONCURRENCY = 3;

const ZERO_SCORES = {
  faithfulness: 0,
  answerRelevancy: 0,
  contextPrecision: 0,
} as const;

type ToolResult = {
  payload: { toolName: string; result: unknown };
};

function catalogEvidence(toolResults: ToolResult[]): CatalogEvidence[] {
  const evidence: CatalogEvidence[] = [];
  for (const toolResult of toolResults) {
    if (toolResult.payload.toolName !== "searchCreatorCatalog") continue;
    const parsed = catalogSearchResultSchema.safeParse(toolResult.payload.result);
    if (parsed.success) evidence.push(...parsed.data.evidence);
  }
  return evidence;
}

/** Run one golden case through the registered production agent and its real tool loop. */
async function runCase(testCase: GoldenCase): Promise<CaseResult> {
  const messages: ModelMessage[] = [
    ...(testCase.history ?? []),
    { role: "user", content: testCase.query },
  ];
  const output = await nexusAgent.generate(messages, {
    maxSteps: NEXUS_MAX_STEPS,
  });
  const evidence = catalogEvidence(output.toolResults);
  const refused = await assessUnsupportedAnswer({
    query: testCase.query,
    answer: output.text,
    contextTexts: evidence.map((item) => item.text),
  });
  const scores = testCase.expectRefusal
    ? undefined
    : refused
      ? ZERO_SCORES
      : await scoreAnswer({
          query: testCase.query,
          answer: output.text,
          contextTexts: evidence.map((item) => item.text),
        });

  return {
    id: testCase.id,
    expectRefusal: !!testCase.expectRefusal,
    refused,
    scores,
    answer: output.text,
    citations: evidence,
  };
}

export async function runEvalSuite(options?: {
  cases?: GoldenCase[];
  concurrency?: number;
}): Promise<{ results: CaseResult[]; summary: EvalSummary }> {
  const cases = options?.cases ?? GOLDEN_SET;
  validateGolden(cases);

  const results = await pMap(cases, runCase, {
    concurrency: options?.concurrency ?? CASE_CONCURRENCY,
  });
  return { results, summary: summarize(results) };
}
