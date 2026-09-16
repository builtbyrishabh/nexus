import { buildEvidencePacket } from "~/server/domain/citations";
import type { Evidence } from "~/server/domain/types";

/**
 * The refusal — "the refusal is the product" (docs/DESIGN.md §1). It lives here once, as a function
 * of the creator so the Panel (Slice 4) can refuse per column: the agent is instructed to emit
 * exactly this when the evidence falls short, `ask()` emits it directly when retrieval returns
 * nothing, and the eval harness uses it to detect refusals — one definition, every reader → no
 * drift. Neutral "their" on purpose: we never infer a pronoun from a creator's name.
 *
 * Unscoped (home chat, eval across the whole corpus) passes no name and gets a neutral sentence;
 * a Panel column passes its creator's display name. Both are the product's one refusal voice.
 */
export function refusalText(creatorName?: string): string {
  return creatorName
    ? `${creatorName} hasn't covered that in their videos.`
    : "That isn't covered in these videos.";
}

/**
 * Did the model refuse? True iff the *whole* answer is the canonical refusal for this creator.
 * This is the axis the eval gate holds at 1.0, so the check has to be tight in both directions: a
 * prefix match would (a) miss a correct refusal the model wrapped in quotes or a "Sorry," lead-in,
 * failing the gate on right behavior, and (b) count a hedge like "She doesn't cover that… but she
 * does say X [1]" as a refusal — precisely the hedge the instructions forbid. So we normalize away
 * surrounding quotes, whitespace, and trailing punctuation, then require equality, not a prefix.
 * `creatorName` must match the one the answer was generated for (undefined for the unscoped path).
 */
export function isRefusal(text: string, creatorName?: string): boolean {
  const normalize = (s: string) =>
    s
      .trim()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim()
      .replace(/[.!?]+$/, "")
      .toLowerCase();
  return normalize(text) === normalize(refusalText(creatorName));
}

/**
 * The user turn handed to the generation agent: the numbered evidence packet followed by the
 * question. Marker `[n]` in the answer maps 1:1 to evidence entry `n` (see buildEvidencePacket),
 * which is in turn `citations[n-1]`. Shared so streaming answers and eval-time answers are
 * generated from byte-identical prompts — the eval only means something if it grades the real path.
 *
 * When scoped to a creator (a Panel column), a directive naming that creator and their exact
 * refusal sentence leads the turn, so the static agent prompt's generic refusal is specialized
 * per column. Unscoped (home chat / eval) passes no name and the turn is unchanged — which is why
 * the eval gate keeps grading the same prompt it always has.
 */
export function buildAnswerMessages(
  query: string,
  evidence: Evidence[],
  creatorName?: string,
): { role: "user"; content: string }[] {
  const directive = creatorName
    ? `You are answering about ${creatorName}'s YouTube catalog. If the Evidence does not address the exact thing asked, reply with exactly "${refusalText(creatorName)}" and nothing else.\n\n`
    : "";
  return [
    {
      role: "user",
      content: `${directive}Evidence:\n\n${buildEvidencePacket(evidence)}\n\nQuestion: ${query}`,
    },
  ];
}
