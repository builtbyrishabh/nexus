import { buildEvidencePacket } from "~/server/domain/citations";
import type { Evidence } from "~/server/domain/types";

/**
 * The refusal — "the refusal is the product" (docs/DESIGN.md §1). It lives here once: the agent
 * is instructed to emit exactly this when the evidence falls short, and `ask()` emits it directly
 * when retrieval returns nothing, so every surface refuses in one voice. The eval harness also
 * imports it to detect refusals. One string, three readers → no drift.
 */
export const REFUSAL_TEXT = "He doesn't cover that in his videos.";

/**
 * Did the model refuse? True iff the answer opens with the canonical refusal (case-insensitive,
 * tolerant of trailing prose). Used by the eval harness to grade the refusal decision.
 */
export function isRefusal(text: string): boolean {
  return text.trim().toLowerCase().startsWith(REFUSAL_TEXT.toLowerCase());
}

/**
 * The user turn handed to the generation agent: the numbered evidence packet followed by the
 * question. Marker `[n]` in the answer maps 1:1 to evidence entry `n` (see buildEvidencePacket),
 * which is in turn `citations[n-1]`. Shared so streaming answers and eval-time answers are
 * generated from byte-identical prompts — the eval only means something if it grades the real path.
 */
export function buildAnswerMessages(
  query: string,
  evidence: Evidence[],
): { role: "user"; content: string }[] {
  return [
    {
      role: "user",
      content: `Evidence:\n\n${buildEvidencePacket(evidence)}\n\nQuestion: ${query}`,
    },
  ];
}
