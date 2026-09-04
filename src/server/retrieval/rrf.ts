/**
 * Reciprocal Rank Fusion — merge several ranked lists of the same items into one ranking using
 * only positions, never scores. Each list contributes `1/(k + rank)` per item (rank is 1-based),
 * and an item's fused score is the sum across the lists it appears in.
 *
 * Rank-only fusion is the point: dense (cosine, ~0..1) and sparse (BM25/ts_rank, unbounded) live
 * on incomparable scales, so naively adding their scores lets one axis dominate. RRF sidesteps
 * that with no per-axis normalization to tune — the standard, boring, correct fix.
 *
 * `k` (default 60, the canonical value) flattens the weight of the very top ranks so a single
 * list can't run away with the result. Pure and deterministic: identical inputs give identical
 * order, and ties break by first appearance so the order is stable across runs.
 */
export type Fused = { id: string; score: number };

export function rrfFuse(rankings: string[][], opts?: { k?: number }): Fused[] {
  const k = opts?.k ?? 60;
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const list of rankings) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, order++);
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || firstSeen.get(a.id)! - firstSeen.get(b.id)!);
}
