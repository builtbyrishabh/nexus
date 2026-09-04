/**
 * Neighbor expansion. Chunking cuts a transcript at ~250-token boundaries, so the sentence
 * that actually answers a question can straddle the edge of the retrieved chunk. After ranking,
 * we widen each hit with its ±1 chunk_index neighbors — extra reading context for the model —
 * while the hit keeps its single citation at its own timestamp (neighbors are context, not
 * separately-citable claims).
 *
 * These are the pure helpers; the DB fetch that reads the neighbor text lives in retrieve().
 */

export type Hit = { sourceId: string; chunkIndex: number };

/** Stable key for a chunk position within a source. */
export function neighborKey(sourceId: string, index: number): string {
  return `${sourceId}:${index}`;
}

/**
 * The distinct neighbor coordinates to fetch for a set of hits. Skips negative indexes and any
 * coordinate that is itself a hit — that chunk's text is already present as its own Evidence,
 * so pulling it again would duplicate content across two entries.
 */
export function neighborCoords(
  hits: Hit[],
  radius: number,
): { sourceId: string; index: number }[] {
  const hitKeys = new Set(hits.map((h) => neighborKey(h.sourceId, h.chunkIndex)));
  const wanted = new Map<string, { sourceId: string; index: number }>();

  for (const h of hits) {
    for (let d = -radius; d <= radius; d++) {
      if (d === 0) continue;
      const index = h.chunkIndex + d;
      if (index < 0) continue;
      const key = neighborKey(h.sourceId, index);
      if (hitKeys.has(key)) continue;
      wanted.set(key, { sourceId: h.sourceId, index });
    }
  }

  return [...wanted.values()];
}

/** Join a hit's text with whatever neighbor text exists on each side, in reading order. */
export function mergeNeighborText(
  before: string | undefined,
  hit: string,
  after: string | undefined,
): string {
  return [before, hit, after]
    .filter((t): t is string => !!t && t.trim().length > 0)
    .join(" ");
}
