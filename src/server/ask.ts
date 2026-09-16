import type { ModelMessage } from "ai";

import { buildAnswerMessages, refusalText } from "~/server/answer";
import { evidenceToCitations } from "~/server/domain/citations";
import { displayNameFor } from "~/server/domain/creators";
import type { Ask, AskChunk, Evidence } from "~/server/domain/types";
import { nexusAgent } from "~/server/mastra";
import { retrieve } from "~/server/retrieval/retrieve";

/** How much evidence the answer reads. One knob, shared by every caller of the query path. */
const ANSWER_TOP_K = 5;

export type AnswerOptions = {
  rerank?: boolean;
  /** Scope to one creator's catalog (a Panel column). Absent = unscoped across the whole corpus. */
  creatorHandle?: string;
};

/**
 * The non-streaming front half of the query path: retrieve, then decide between the refusal and
 * a grounded generation. `messages` is absent exactly when there is nothing to ground on, so the
 * caller emits the refusal (`refusalText(creatorName)`) instead of calling the model.
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
  /** The creator this answer is scoped to (undefined when unscoped). Drives the refusal wording. */
  creatorName?: string;
}> {
  const creatorHandle = opts?.creatorHandle;
  const creatorName = displayNameFor(creatorHandle);
  const evidence = await retrieve(query, {
    topK: ANSWER_TOP_K,
    rerank: opts?.rerank,
    filter: creatorHandle ? { creatorHandle } : undefined,
  });
  return {
    evidence,
    creatorName,
    messages:
      evidence.length === 0
        ? undefined
        : buildAnswerMessages(query, evidence, creatorName),
  };
}

/**
 * The one entrypoint every surface calls. Web, Discord, and Telegram all reduce to this.
 *
 * Flow: retrieve → emit citations/sources up front → build a numbered evidence packet → stream a
 * grounded answer with inline [n] markers. Prior turns (`input.history`) are prepended so the model
 * can resolve cross-turn references, but retrieval still runs on the current question alone (query
 * rewrite is identity here) and grounding stays on this turn's Evidence — history is context, not a
 * source. Absent history = single-turn (the eval path). The agentic loop comes later.
 */
export async function* ask(input: Ask): AsyncGenerator<AskChunk> {
  const { evidence, messages, creatorName } = await prepareAnswer(input.query, {
    creatorHandle: input.creatorHandle,
  });

  // Citations/source cards are known before generation, so they stream first.
  const { citations, sources } = evidenceToCitations(evidence);
  yield { citations, sources };

  if (!messages) {
    yield { textDelta: refusalText(creatorName) };
    return;
  }

  // Prior turns as plain context, then the current turn (which carries the Evidence packet).
  const turn: ModelMessage[] = [...(input.history ?? []), ...messages];
  const out = await nexusAgent.stream(turn);

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
