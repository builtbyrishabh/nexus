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
  return mapRanking(
    docs.map((d) => d.id),
    ranking,
  );
}
