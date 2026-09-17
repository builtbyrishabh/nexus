import {
  createAnswerRelevancyScorer,
  createContextPrecisionScorer,
  createFaithfulnessScorer,
} from "@mastra/evals/scorers/prebuilt";
import { generateText, gateway, Output } from "ai";
import { z } from "zod";

import { env } from "~/env";
import type { AxisScores } from "~/server/evals/summary";

const unsupportedAnswerSchema = z.object({
  declinedUnsupportedClaim: z.boolean(),
});

/** Classify the behavior semantically instead of matching one required refusal sentence. */
export async function assessUnsupportedAnswer(input: {
  query: string;
  answer: string;
  contextTexts: string[];
}): Promise<boolean> {
  const { output } = await generateText({
    model: gateway(env.EVAL_MODEL),
    output: Output.object({ schema: unsupportedAnswerSchema }),
    prompt: `Classify whether this assistant response clearly declines to make an unsupported catalog claim.

Return true only when the response says the available catalog evidence is insufficient and does not invent the requested facts. A concise paraphrase is valid; no exact wording is required.

Question:
${input.query}

Catalog evidence:
${input.contextTexts.length > 0 ? input.contextTexts.join("\n\n") : "(none)"}

Assistant response:
${input.answer}`,
  });

  return output.declinedUnsupportedClaim;
}

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
