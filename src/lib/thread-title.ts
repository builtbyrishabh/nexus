/**
 * A chat thread's title: the first question, trimmed to a single 60-char line
 * with an ellipsis when longer. Shared so the optimistic sidebar seed and the
 * persisted server title always agree.
 */
export function deriveThreadTitle(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60).trimEnd()}…` : trimmed;
}
