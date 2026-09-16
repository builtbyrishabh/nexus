/**
 * The refusal — "the refusal is the product" (docs/DESIGN.md §1). It lives here once, as a function
 * of the creator so the query path can refuse per creator: the agent is instructed to emit exactly
 * this when the evidence falls short, `ask()`/`finalizeText` emit it directly for empty evidence, and
 * the eval harness uses it to detect refusals — one definition, every reader → no drift. Neutral
 * "their" on purpose: we never infer a pronoun from a creator's name.
 *
 * A whole-collection scope passes no name and gets a neutral sentence; a scope that resolves to a
 * single creator passes their display name. Both are the product's one refusal voice.
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
