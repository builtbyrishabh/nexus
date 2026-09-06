import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { chunk as chunkTable, source as sourceTable } from "~/server/db/schema";
import type { NewChunk, Source } from "~/server/db/schema";
import type { SourceLoader, SourceRef } from "~/server/domain/types";
import { chunkSegments } from "~/server/ingest/chunk";
import { contextualizeChunks } from "~/server/ingest/contextualize";
import { embedTexts } from "~/server/ingest/embed";
import { youtubeLoader } from "~/server/ingest/youtube-loader";
import { toVideoId } from "~/server/ingest/youtube-url";

export type IngestResult = {
  sourceId: string;
  title: string;
  chunks: number;
  skipped: boolean;
};

function skipped(existing: Source): IngestResult {
  return { sourceId: existing.id, title: existing.title, chunks: 0, skipped: true };
}

/**
 * Ingest one source end-to-end, idempotently: load → chunk (carry timestamps) → contextualize
 * → embed → upsert. Each chunk gets a Contextual-Retrieval blurb before embedding; `tsv` is a
 * generated column the DB computes from context + text. Re-running an unchanged transcript is
 * a no-op.
 *
 * Source-agnostic (docs/DESIGN.md §4a): the loader owns everything source-specific, so a new
 * kind of source is a new loader, not a change here. `ref.kind` is the only place kind enters.
 *
 * Idempotency has two gates, cheapest first:
 *   1. A source whose transcript came from Whisper is final — the audio never changes, and
 *      re-transcribing is the most expensive thing ingest does — so it is skipped before any
 *      load. (To force a re-transcribe, delete the row.)
 *   2. Otherwise the transcript is loaded (captions: free) and hashed; an unchanged hash skips
 *      before metadata is fetched or anything is written.
 * All remote work (transcript, contexts, embeddings) happens BEFORE any write, and the source
 * hash + chunk swap commit together in one transaction — so a failed embed or insert never
 * leaves a fresh hash pointing at missing chunks (which the next run would wrongly skip).
 */
export async function ingestSource(
  ref: SourceRef,
  loader: SourceLoader,
): Promise<IngestResult> {
  const existing = await db.query.source.findFirst({
    where: and(
      eq(sourceTable.kind, ref.kind),
      eq(sourceTable.externalId, ref.externalId),
    ),
  });
  if (existing?.metadata?.transcript === "whisper") return skipped(existing);

  const { segments, provenance } = await loader.loadTranscript(ref);
  const transcriptText = segments.map((s) => s.text).join("\n");
  const contentHash = createHash("sha256")
    .update(transcriptText)
    .digest("hex");
  if (existing && existing.contentHash === contentHash) return skipped(existing);

  // Transcript is new or changed → we will write. Fetch metadata and do all remote work up front;
  // if any of it throws, nothing below runs and no row changes.
  // Contextual Retrieval: situate each chunk in the full transcript, then embed
  // `context + "\n" + text` (locked storage rule) so the vector carries the context while the
  // raw `text` stays separate for lexical search + display.
  const meta = await loader.loadMeta(ref);
  const built = chunkSegments(segments);
  const contexts = await contextualizeChunks(
    transcriptText,
    built.map((c) => c.text),
  );
  const embeddings = await embedTexts(
    built.map((c, i) => `${contexts[i]}\n${c.text}`),
  );

  const sourceFields = {
    title: meta.title,
    url: meta.url,
    author: meta.author,
    publishedAt: meta.publishedAt,
    contentHash,
    metadata: { transcript: provenance },
  };

  // Atomic swap: upsert the source (hash included), replace its chunks. The new hash is only
  // durable once every replacement row is in — no window where the hash is ahead of the data.
  const result = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(sourceTable)
      .values({ kind: ref.kind, externalId: ref.externalId, ...sourceFields })
      .onConflictDoUpdate({
        target: [sourceTable.kind, sourceTable.externalId],
        set: sourceFields,
      })
      .returning();

    const sourceId = saved!.id;

    await tx.delete(chunkTable).where(eq(chunkTable.sourceId, sourceId));

    const rows: NewChunk[] = built.map((c, i) => ({
      sourceId,
      chunkIndex: i,
      text: c.text,
      contextText: contexts[i]!,
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
    title: meta.title,
    chunks: result.chunks,
    skipped: false,
  };
}

/**
 * The YouTube entrypoint: accepts a video ID or any YouTube URL, canonicalizes it once so
 * identity, uniqueness, and the watch URL agree, then runs the source-agnostic pipeline.
 */
export function ingestVideo(input: string): Promise<IngestResult> {
  return ingestSource(
    { kind: "youtube_video", externalId: toVideoId(input) },
    youtubeLoader,
  );
}
