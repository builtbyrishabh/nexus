import type { ModelMessage } from "ai";
import { RequestContext } from "@mastra/core/request-context";
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
import {
  loadSourceLibrary,
  type NexusRequestContext,
} from "~/server/domain/source-library";

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

/** Every answerable case must cite at least one returned evidence ID, and only returned IDs. */
export function citationsMatchEvidence(
  answer: string,
  evidence: CatalogEvidence[],
): boolean {
  const citedIds = [...answer.matchAll(/\[cite:([^\]\s]+)\]/g)].map(
    (match) => match[1]!,
  );
  const evidenceIds = new Set(evidence.map((item) => item.citationId));
  return citedIds.length > 0 && citedIds.every((id) => evidenceIds.has(id));
}

/** Run one golden case through the registered production agent and its real tool loop. */
async function runCase(
  testCase: GoldenCase,
  context: NexusRequestContext,
): Promise<CaseResult> {
  const messages: ModelMessage[] = [
    ...(testCase.history ?? []),
    { role: "user", content: testCase.query },
  ];
  const requestContext = new RequestContext<NexusRequestContext>();
  requestContext.set("userId", context.userId);
  requestContext.set("hasSources", context.hasSources);
  requestContext.set("allowedCreators", context.allowedCreators);
  const output = await nexusAgent.generate(messages, {
    maxSteps: NEXUS_MAX_STEPS,
    requestContext,
  });
  const evidence = catalogEvidence(output.toolResults);
  const citationsValid = citationsMatchEvidence(output.text, evidence);
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
    citationsValid,
  };
}

export async function runEvalSuite(options?: {
  userId: string;
  cases?: GoldenCase[];
  concurrency?: number;
}): Promise<{ results: CaseResult[]; summary: EvalSummary }> {
  if (!options?.userId) throw new Error("An eval user ID is required");
  const cases = options?.cases ?? GOLDEN_SET;
  validateGolden(cases);
  const library = await loadSourceLibrary(options.userId);
  const context = { userId: options.userId, ...library };

  const results = await pMap(cases, (testCase) => runCase(testCase, context), {
    concurrency: options?.concurrency ?? CASE_CONCURRENCY,
  });
  return { results, summary: summarize(results) };
}
