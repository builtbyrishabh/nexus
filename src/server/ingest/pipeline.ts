import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { chunk as chunkTable, source as sourceTable } from "~/server/db/schema";
import type { NewChunk } from "~/server/db/schema";
import type { SourceRef } from "~/server/domain/types";
import { chunkSegments } from "~/server/ingest/chunk";
import { contextualizeChunks } from "~/server/ingest/contextualize";
import { embedTexts } from "~/server/ingest/embed";
import { toVideoId, youtubeLoader } from "~/server/ingest/youtube-loader";

export type IngestResult = {
  sourceId: string;
  title: string;
  chunks: number;
  skipped: boolean;
};

/**
 * Ingest one video end-to-end, idempotently: load → chunk (carry timestamps) → contextualize
 * → embed → upsert. Each chunk gets a Contextual-Retrieval blurb before embedding; `tsv` is a
 * generated column the DB computes from context + text. Re-running an unchanged transcript is
 * a no-op.
 *
 * Accepts a video ID or any YouTube URL; both are canonicalized to the video ID so identity,
 * uniqueness, and the watch URL agree. All remote work (transcript, embeddings) happens
 * BEFORE any write, and the source hash + chunk swap commit together in one transaction — so
 * a failed embed or insert never leaves a fresh hash pointing at missing chunks (which the
 * next run would wrongly skip).
 */
export async function ingestVideo(input: string): Promise<IngestResult> {
  const videoId = toVideoId(input);
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

  // Do all remote work up front. If any of it throws, nothing below runs and no row changes.
  // Contextual Retrieval: situate each chunk in the full transcript, then embed
  // `context + "\n" + text` (locked storage rule) so the vector carries the context while the
  // raw `text` stays separate for lexical search + display.
  const built = chunkSegments(loaded.segments);
  const contexts =
    built.length === 0
      ? []
      : await contextualizeChunks(
          transcriptText,
          built.map((c) => c.text),
        );
  const embeddings =
    built.length === 0
      ? []
      : await embedTexts(built.map((c, i) => `${contexts[i]}\n${c.text}`));

  // Atomic swap: upsert the source (hash included), replace its chunks. The new hash is only
  // durable once every replacement row is in — no window where the hash is ahead of the data.
  const result = await db.transaction(async (tx) => {
    const [saved] = await tx
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

    await tx.delete(chunkTable).where(eq(chunkTable.sourceId, sourceId));

    const rows: NewChunk[] = built.map((c, i) => ({
      sourceId,
      chunkIndex: i,
      text: c.text,
      contextText: contexts[i] ?? "",
      embedding: embeddings[i]!,
      startSec: c.startSec,
      endSec: c.endSec,
      tokenCount: c.tokenCount,
    }));

    // Insert in batches to stay well under parameter limits.
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await tx.insert(chunkTable).values(rows.slice(i, i + BATCH));
    }

    return { sourceId, chunks: rows.length };
  });

  return {
    sourceId: result.sourceId,
    title: loaded.source.title,
    chunks: result.chunks,
    skipped: false,
  };
}
