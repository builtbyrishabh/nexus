import { buildAnswerMessages, REFUSAL_TEXT } from "~/server/answer";
import { evidenceToCitations } from "~/server/domain/citations";
import type { Ask, AskChunk, Evidence } from "~/server/domain/types";
import { nexusAgent } from "~/server/mastra";
import { retrieve } from "~/server/retrieval/retrieve";

/** How much evidence the answer reads. One knob, shared by every caller of the query path. */
const ANSWER_TOP_K = 5;

export type AnswerOptions = { rerank?: boolean };

/**
 * The non-streaming front half of the query path: retrieve, then decide between the refusal and
 * a grounded generation. `messages` is absent exactly when there is nothing to ground on, so the
 * caller emits `REFUSAL_TEXT` instead of calling the model.
 *
 * This is the ONE place the query path is defined. `ask()` finishes it by streaming; the eval
 * harness finishes it with a blocking generate. Anything Tier 2 adds here (query rewrite, agentic
 * retrieval) is therefore measured by the eval the moment it ships — there is no second copy to
 * keep in sync. `rerank` passes straight through to `retrieve()` so the eval can A/B it.
 */
export async function prepareAnswer(
  query: string,
  opts?: AnswerOptions,
): Promise<{
  evidence: Evidence[];
  messages?: ReturnType<typeof buildAnswerMessages>;
}> {
  const evidence = await retrieve(query, {
    topK: ANSWER_TOP_K,
    rerank: opts?.rerank,
  });
  return {
    evidence,
    messages:
      evidence.length === 0 ? undefined : buildAnswerMessages(query, evidence),
  };
}

/**
 * The one entrypoint every surface calls. Web, Discord, and Telegram all reduce to this.
 *
 * Slice 0 flow (fixed, single-turn): retrieve → emit citations/sources up front → build a
 * numbered evidence packet → stream a grounded answer with inline [n] markers. Query rewrite
 * is identity here; conversational memory and the agentic loop come later.
 */
export async function* ask(input: Ask): AsyncGenerator<AskChunk> {
  const { evidence, messages } = await prepareAnswer(input.query);

  // Citations/source cards are known before generation, so they stream first.
  const { citations, sources } = evidenceToCitations(evidence);
  yield { citations, sources };

  if (!messages) {
    yield { textDelta: REFUSAL_TEXT };
    return;
  }

  const out = await nexusAgent.stream(messages);

  const reader = out.textStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield { textDelta: value };
    }
  } finally {
    reader.releaseLock();
  }
}
