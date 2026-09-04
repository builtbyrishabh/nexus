import { sql } from "drizzle-orm";

import { db } from "~/server/db";
import { chunk, source } from "~/server/db/schema";
import type { Evidence, Filter } from "~/server/domain/types";
import { embedQuery } from "~/server/ingest/embed";

type Row = {
  chunk_id: string;
  source_id: string;
  text: string;
  start_sec: number | null;
  end_sec: number | null;
  score: number;
  title: string;
  url: string;
};

/**
 * The retrieval deep module — one stable contract; the pipeline is hidden inside.
 *
 * Slice 0 internals: dense cosine top-K over pgvector (HNSW). Slice 1 pours sparse (tsv/BM25),
 * RRF fusion, reranking, and neighbor expansion into THIS function without changing callers.
 */
export async function retrieve(
  query: string,
  opts?: { topK?: number; filter?: Filter },
): Promise<Evidence[]> {
  const topK = opts?.topK ?? 5;
  const qvec = `[${(await embedQuery(query)).join(",")}]`;

  const sourceIds = opts?.filter?.sourceIds;
  const filterSql =
    sourceIds && sourceIds.length > 0
      ? sql`WHERE c.source_id IN ${sql.raw(
          `(${sourceIds.map((id) => `'${id}'`).join(",")})`,
        )}`
      : sql``;

  const rows = (await db.execute(sql`
    SELECT
      c.id AS chunk_id,
      c.source_id AS source_id,
      c.text AS text,
      c.start_sec AS start_sec,
      c.end_sec AS end_sec,
      1 - (c.embedding <=> ${qvec}::vector) AS score,
      s.title AS title,
      s.url AS url
    FROM ${chunk} c
    JOIN ${source} s ON s.id = c.source_id
    ${filterSql}
    ORDER BY c.embedding <=> ${qvec}::vector
    LIMIT ${topK}
  `)) as unknown as Row[];

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    sourceId: r.source_id,
    text: r.text,
    score: Number(r.score),
    locator:
      r.start_sec === null
        ? undefined
        : { startSec: r.start_sec, endSec: r.end_sec ?? r.start_sec },
    source: { title: r.title, url: r.url },
  }));
}
