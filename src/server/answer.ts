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
 * Did the model refuse? True iff the *whole* answer is the canonical refusal. This is the axis the
 * eval gate holds at 1.0, so the check has to be tight in both directions: a prefix match would (a)
 * miss a correct refusal the model wrapped in quotes or a "Sorry," lead-in, failing the gate on
 * right behavior, and (b) count a hedge like "He doesn't cover that… but he does say X [1]" as a
 * refusal — precisely the hedge the instructions forbid. So we normalize away surrounding quotes,
 * whitespace, and trailing punctuation, then require equality with the refusal, not a prefix.
 */
export function isRefusal(text: string): boolean {
  const normalize = (s: string) =>
    s
      .trim()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim()
      .replace(/[.!?]+$/, "")
      .toLowerCase();
  return normalize(text) === normalize(REFUSAL_TEXT);
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
