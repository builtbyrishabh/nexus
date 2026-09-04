import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { chunk as chunkTable, source as sourceTable } from "~/server/db/schema";
import type { NewChunk } from "~/server/db/schema";
import type { SourceRef } from "~/server/domain/types";
import { chunkSegments } from "~/server/ingest/chunk";
import { embedTexts } from "~/server/ingest/embed";
import { youtubeLoader } from "~/server/ingest/youtube-loader";

export type IngestResult = {
  sourceId: string;
  title: string;
  chunks: number;
  skipped: boolean;
};

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Ingest one video end-to-end, idempotently. Naive Slice 0 pipeline: load → chunk (carry
 * timestamps) → embed → upsert. `context_text` stays empty (Slice 1 fills it); `tsv` is a
 * generated column the DB computes. Re-running with an unchanged transcript is a no-op.
 */
export async function ingestVideo(videoId: string): Promise<IngestResult> {
  const ref: SourceRef = { kind: "youtube_video", externalId: videoId };
  const loaded = await youtubeLoader.load(ref);

  const transcriptText = loaded.segments.map((s) => s.text).join("\n");
  const contentHash = createHash("sha256")
    .update(transcriptText)
    .digest("hex");

  const existing = await db.query.source.findFirst({
    where: and(
      eq(sourceTable.kind, "youtube_video"),
      eq(sourceTable.externalId, videoId),
    ),
  });

  if (existing && existing.contentHash === contentHash) {
    return {
      sourceId: existing.id,
      title: existing.title,
      chunks: 0,
      skipped: true,
    };
  }

  // Upsert the source row (idempotency anchor).
  const [saved] = await db
    .insert(sourceTable)
    .values({
      kind: "youtube_video",
      externalId: videoId,
      title: loaded.source.title,
      url: loaded.source.url,
      author: loaded.source.author,
      publishedAt: loaded.source.publishedAt,
      contentHash,
    })
    .onConflictDoUpdate({
      target: [sourceTable.kind, sourceTable.externalId],
      set: {
        title: loaded.source.title,
        url: loaded.source.url,
        author: loaded.source.author,
        contentHash,
      },
    })
    .returning();

  const sourceId = saved!.id;

  // Idempotent re-ingest: replace this source's chunks.
  await db.delete(chunkTable).where(eq(chunkTable.sourceId, sourceId));

  const built = chunkSegments(loaded.segments);
  if (built.length === 0) {
    return { sourceId, title: loaded.source.title, chunks: 0, skipped: false };
  }

  // Slice 0: context_text is empty, so embed(text). The seam is preserved for Slice 1.
  const embeddings = await embedTexts(built.map((c) => c.text));

  const rows: NewChunk[] = built.map((c, i) => ({
    sourceId,
    chunkIndex: i,
    text: c.text,
    contextText: "",
    embedding: embeddings[i]!,
    startSec: c.startSec,
    endSec: c.endSec,
    tokenCount: c.tokenCount,
  }));

  // Insert in batches to stay well under parameter limits.
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(chunkTable).values(rows.slice(i, i + BATCH));
  }

  return {
    sourceId,
    title: loaded.source.title,
    chunks: rows.length,
    skipped: false,
  };
}

export { toVectorLiteral };
