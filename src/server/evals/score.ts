import {
  createAnswerRelevancyScorer,
  createContextPrecisionScorer,
  createFaithfulnessScorer,
} from "@mastra/evals/scorers/prebuilt";
import { gateway } from "ai";

import { env } from "~/env";
import type { AxisScores } from "~/server/evals/summary";

/**
 * Grade one answer on the three Tier-1 axes using Mastra's built-in LLM-judge scorers (native,
 * per docs/ARCHITECTURE.md — we write no scoring prompts). The grounding context is the exact
 * evidence texts the model was given, so faithfulness and context-precision judge against what
 * the model actually read. Scorers are constructed per call because their context is per-query;
 * construction is config-only (no I/O), so this is cheap.
 *
 * - Faithfulness: are the answer's claims supported by the context? (hallucination guard)
 * - Answer Relevancy: does the answer actually address the question?
 * - Context Precision: are the retrieved contexts relevant, and ranked relevant-first? (retrieval)
 */
export async function scoreAnswer(input: {
  query: string;
  answer: string;
  contextTexts: string[];
}): Promise<AxisScores> {
  const model = gateway(env.EVAL_MODEL);
  const run = { input: input.query, output: input.answer };

  const [faithfulness, answerRelevancy, contextPrecision] = await Promise.all([
    createFaithfulnessScorer({
      model,
      options: { context: input.contextTexts },
    }).run(run),
    createAnswerRelevancyScorer({ model }).run(run),
    createContextPrecisionScorer({
      model,
      options: { context: input.contextTexts },
    }).run(run),
  ]);

  return {
    faithfulness: faithfulness.score,
    answerRelevancy: answerRelevancy.score,
    contextPrecision: contextPrecision.score,
  };
}
