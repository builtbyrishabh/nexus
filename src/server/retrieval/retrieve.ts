import { sql, type SQL } from "drizzle-orm";

import { db } from "~/server/db";
import { chunk, source, userSource } from "~/server/db/schema";
import type { Evidence } from "~/server/domain/types";
import { embedQuery } from "~/server/ingest/embed";
import {
  mergeNeighborText,
  neighborCoords,
  neighborKey,
} from "~/server/retrieval/neighbors";
import { rerankDocuments } from "~/server/retrieval/rerank";
import { rrfFuse } from "~/server/retrieval/rrf";

// Canonical settings (docs/ARCHITECTURE.md): each retriever returns a top-20 candidate pool;
// RRF fuses them with k=60. When reranking, that same fused pool (up to CANDIDATE_K after the cut)
// is the reranker's input; otherwise the fused top-K is the answer. Neighbor radius is ±1.
const CANDIDATE_K = 20;
const RRF_K = 60;
const NEIGHBOR_RADIUS = 1;

type HydratedRow = {
  chunk_id: string;
  source_id: string;
  chunk_index: number;
  text: string;
  context_text: string;
  start_sec: number | null;
  end_sec: number | null;
  title: string;
  author: string | null;
  url: string;
};

/**
 * Bind a JS array as ONE Postgres array parameter. Drizzle's `sql` template expands a bare array
 * into `($1, $2, …)` — a row value, not an array — so `ANY(${ids}::uuid[])` fails with "cannot cast
 * type record to uuid[]". `sql.param` sends the array itself, which postgres-js serializes natively.
 */
const uuidArray = (ids: string[]): SQL => sql`${sql.param(ids)}::uuid[]`;

/** Dense retriever: pgvector cosine nearest-neighbors (HNSW). Returns chunk ids, best first. */
async function denseSearch(
  qvec: string,
  userId: string,
  creatorHandle?: string,
): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT c.id AS id
    FROM ${chunk} c
    JOIN ${userSource} us
      ON us.source_id = c.source_id AND us.user_id = ${userId}
    JOIN ${source} s ON s.id = c.source_id
    ${creatorHandle ? sql`WHERE s.creator_handle = ${creatorHandle}` : sql``}
    ORDER BY c.embedding <=> ${qvec}::vector
    LIMIT ${CANDIDATE_K}
  `)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Sparse retriever: Postgres full-text over the generated `tsv` column, ranked by ts_rank_cd
 * (rewards term proximity + density). `websearch_to_tsquery` parses the raw user query — quoted
 * phrases, OR, `-negation` — safely, and yields no rows for an empty/stopword-only query, which
 * RRF then simply treats as a missing list. This is what dense misses: exact names and jargon.
 */
async function sparseSearch(
  query: string,
  userId: string,
  creatorHandle?: string,
): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT c.id AS id
    FROM ${chunk} c
    JOIN ${userSource} us
      ON us.source_id = c.source_id AND us.user_id = ${userId}
    JOIN ${source} s ON s.id = c.source_id
    CROSS JOIN websearch_to_tsquery('english', ${query}) AS q
    WHERE c.tsv @@ q
      ${creatorHandle ? sql`AND s.creator_handle = ${creatorHandle}` : sql``}
    ORDER BY ts_rank_cd(c.tsv, q) DESC
    LIMIT ${CANDIDATE_K}
  `)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

/** Load full rows for a set of chunk ids, keyed by id so callers can re-impose the fused order. */
async function hydrate(ids: string[]): Promise<Map<string, HydratedRow>> {
  if (ids.length === 0) return new Map();
  const rows = (await db.execute(sql`
    SELECT
      c.id AS chunk_id,
      c.source_id AS source_id,
      c.chunk_index AS chunk_index,
      c.text AS text,
      c.context_text AS context_text,
      c.start_sec AS start_sec,
      c.end_sec AS end_sec,
      s.title AS title,
      s.author AS author,
      s.url AS url
    FROM ${chunk} c
    JOIN ${source} s ON s.id = c.source_id
    WHERE c.id = ANY(${uuidArray(ids)})
  `)) as unknown as HydratedRow[];

  return new Map(rows.map((r) => [r.chunk_id, r]));
}

/** Build an Evidence from a ranked row; `text` is passed in so neighbor expansion can widen it. */
function toEvidence(row: HydratedRow, score: number, text: string): Evidence {
  return {
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    excerpt: row.text,
    text,
    context: row.context_text || undefined,
    score,
    locator:
      row.start_sec === null
        ? undefined
        : { startSec: row.start_sec, endSec: row.end_sec ?? row.start_sec },
    source: { title: row.title, url: row.url, author: row.author },
  };
}

/** Fetch just the text of the given neighbor coordinates, keyed for O(1) lookup. */
async function fetchNeighborText(
  coords: { sourceId: string; index: number }[],
): Promise<Map<string, string>> {
  if (coords.length === 0) return new Map();
  const rows = (await db.execute(sql`
    SELECT c.source_id AS source_id, c.chunk_index AS chunk_index, c.text AS text
    FROM ${chunk} c
    WHERE (c.source_id, c.chunk_index) IN (${sql.join(
      coords.map((co) => sql`(${co.sourceId}::uuid, ${co.index}::int)`),
      sql`, `,
    )})
  `)) as unknown as {
    source_id: string;
    chunk_index: number;
    text: string;
  }[];
  return new Map(
    rows.map((r) => [neighborKey(r.source_id, r.chunk_index), r.text]),
  );
}

/** Widen each hit with its ±1 chunk_index neighbors as extra context; the citation is unchanged. */
async function expandNeighbors(
  hits: { row: HydratedRow; score: number }[],
): Promise<Evidence[]> {
  const coords = neighborCoords(
    hits.map((h) => ({
      sourceId: h.row.source_id,
      chunkIndex: h.row.chunk_index,
    })),
    NEIGHBOR_RADIUS,
  );
  const neighborText = await fetchNeighborText(coords);

  return hits.map(({ row, score }) => {
    const before = neighborText.get(
      neighborKey(row.source_id, row.chunk_index - 1),
    );
    const after = neighborText.get(
      neighborKey(row.source_id, row.chunk_index + 1),
    );
    return toEvidence(row, score, mergeNeighborText(before, row.text, after));
  });
}

/**
 * The retrieval deep module — one stable contract; the pipeline is hidden inside.
 *
 * Internals: dense (pgvector cosine) + sparse (tsv/BM25) each retrieve a top-20 pool, fused by
 * RRF (k=60) into one ranking. The fused top-20 is scored by a cross-encoder and cut to top-K,
 * then widened with its ±1 neighbors. Reranking is the only
 * production mode and provider failures propagate to the caller. Evidence.score carries the
 * reranker's relevance score.
 */
export async function retrieve(
  query: string,
  opts: { userId: string; creatorHandle?: string; topK?: number },
): Promise<Evidence[]> {
  const topK = opts?.topK ?? 5;

  // Only dense needs the embedding; start it, then overlap the round trip with the sparse search
  // instead of paying its latency serially in front of both retrievers.
  const qvecP = embedQuery(query).then((v) => `[${v.join(",")}]`);
  const [dense, sparse] = await Promise.all([
    qvecP.then((qvec) => denseSearch(qvec, opts.userId, opts.creatorHandle)),
    sparseSearch(query, opts.userId, opts.creatorHandle),
  ]);

  const fused = rrfFuse([dense, sparse], { k: RRF_K });

  const poolIds = fused.slice(0, CANDIDATE_K).map((f) => f.id);
  const byId = await hydrate(poolIds);
  const pool = poolIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id, row }] : [];
  });

  // The reranker scores the same `context + "\n" + text` string that was embedded (the locked
  // storage rule): the blurb is what ties "Caleb's 90-day results" to a chunk that only says
  // "so what is it now?". Measured on raw text alone it promoted intro chunks and lost every axis.
  const ranked = await rerankDocuments(
    query,
    pool.map((item) => ({
      id: item.id,
      text: `${item.row.context_text}\n${item.row.text}`,
    })),
    topK,
  );

  const hits = ranked.flatMap(({ id, score }) => {
    const row = byId.get(id);
    return row ? [{ row, score }] : [];
  });

  return expandNeighbors(hits);
}
