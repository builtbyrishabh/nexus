import { gateway, rerank } from "ai";

import { env } from "~/env";

export type RankedId = { id: string; score: number };

/**
 * Pure remap: the AI SDK's `rerank` ranks by position in the `documents` array it was handed, so
 * it returns `originalIndex` back into that array. We fed it candidate texts in a known id order,
 * so this turns the model's ranking back into chunk ids + relevance scores. Out-of-range indices
 * are dropped defensively — a well-behaved model never emits them, but retrieval must not throw.
 */
export function mapRanking(
  ids: string[],
  ranking: { originalIndex: number; score: number }[],
): RankedId[] {
  return ranking
    .filter((r) => r.originalIndex >= 0 && r.originalIndex < ids.length)
    .map((r) => ({ id: ids[r.originalIndex]!, score: r.score }));
}

/**
 * The relevance floor. Reranker scores are absolute (query × chunk relevance), unlike RRF's
 * positional sums, so they can say "nothing here is about that". When even the best candidate
 * is below the floor the whole ranking is dropped, retrieval returns nothing, and the query path
 * refuses without a model call — deterministic, where the prompt-level rule was a coin flip on
 * near-misses ("finance person" vs "CFO"). Calibrated on cohere/rerank-v3.5 against the golden set
 * (2026-09-07, 31 videos): off-topic refusals top out at 0.13, the CFO near-miss at 0.38, the
 * weakest answerable question at 0.53. Recalibrate if RERANK_MODEL changes.
 */
export const MIN_RERANK_SCORE = 0.45;

export function aboveFloor(
  ranked: RankedId[],
  floor = MIN_RERANK_SCORE,
): RankedId[] {
  return ranked.some((r) => r.score >= floor) ? ranked : [];
}

/**
 * Cross-encoder rerank of candidate chunks against the query → the top-N most relevant, best
 * first. Unlike RRF (which only sees rank positions), the reranker reads the query and each
 * chunk's text together, so it can catch relevance that bi-encoder recall missed. This is the
 * one step that reads full candidate text, which is why it slots in after fusion, over a small
 * pool. Routed through the AI Gateway (same credential as embeddings + generation).
 */
export async function rerankDocuments(
  query: string,
  docs: { id: string; text: string }[],
  topN: number,
): Promise<RankedId[]> {
  if (docs.length === 0) return [];
  const { ranking } = await rerank({
    model: gateway.rerankingModel(env.RERANK_MODEL),
    query,
    documents: docs.map((d) => d.text),
    topN,
  });
  return aboveFloor(
    mapRanking(
      docs.map((d) => d.id),
      ranking,
    ),
  );
}
