import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { chunk as chunkTable, source as sourceTable } from "~/server/db/schema";
import type { NewChunk } from "~/server/db/schema";
import type {
  SourceLoader,
  SourceProvenance,
  SourceRef,
  Transcript,
} from "~/server/domain/types";
import { chunkSegments } from "~/server/ingest/chunk";
import { contextualizeChunks } from "~/server/ingest/contextualize";
import { embedTexts } from "~/server/ingest/embed";
import { toVideoId, youtubeLoader } from "~/server/ingest/youtube-loader";

/** One vocabulary for every per-source outcome, from a single video to a whole channel. */
export type IngestResult =
  | { status: "ingested"; ref: SourceRef; sourceId: string; title: string; chunks: number }
  | { status: "skipped"; ref: SourceRef; sourceId: string; title: string; reason: SkipReason }
  | { status: "failed"; ref: SourceRef; error: unknown };

export type SkipReason = "stt-final" | "unchanged";

/** What the gates read from an existing `source` row. */
type ExistingSource = {
  contentHash: string;
  metadata: Record<string, unknown> | null;
};

/**
 * The provenance gate. Pure, so the ordering contract is testable without a DB: an STT
 * transcript is final — nothing upstream can change it, so re-runs must skip before any
 * network call. Runs on the existing row alone, before the transcript is fetched.
 */
export function provenanceGate(existing: ExistingSource | undefined): SkipReason | undefined {
  const provenance = existing?.metadata?.provenance;
  return provenance === "stt" ? "stt-final" : undefined;
}

/**
 * The hash gate. The transcript IS the content: same sha256 means chunks, contexts and
 * embeddings would come out identical, so skip before metadata, contextualize, embed or write.
 */
export function hashGate(
  existing: ExistingSource | undefined,
  contentHash: string,
): SkipReason | undefined {
  return existing?.contentHash === contentHash ? "unchanged" : undefined;
}

export function contentHashOf(transcript: Transcript): string {
  return createHash("sha256")
    .update(transcript.segments.map((s) => s.text).join("\n"))
    .digest("hex");
}

/**
 * Ingest one source end-to-end, idempotently, without naming a source kind. Gates run
 * cheapest first (provenance, then hash); only then `loadMeta -> chunk -> contextualize ->
 * embed -> upsert`.
 *
 * All remote work (transcript, embeddings) happens BEFORE any write, and the source hash +
 * chunk swap commit together in one transaction — so a failed embed or insert never leaves a
 * fresh hash pointing at missing chunks (which the next run would wrongly skip).
 */
export async function ingestSource(
  ref: SourceRef,
  loader: SourceLoader,
): Promise<Exclude<IngestResult, { status: "failed" }>> {
  const existing = await db.query.source.findFirst({
    where: and(
      eq(sourceTable.kind, ref.kind),
      eq(sourceTable.externalId, ref.externalId),
    ),
  });

  const sttFinal = provenanceGate(existing);
  if (existing && sttFinal) {
    return { status: "skipped", ref, sourceId: existing.id, title: existing.title, reason: sttFinal };
  }

  const transcript = await loader.loadTranscript(ref);
  const contentHash = contentHashOf(transcript);

  const unchanged = hashGate(existing, contentHash);
  if (existing && unchanged) {
    return { status: "skipped", ref, sourceId: existing.id, title: existing.title, reason: unchanged };
  }

  // Do all remote work up front. If any of it throws, nothing below runs and no row changes.
  // Contextual Retrieval: situate each chunk in the full transcript, then embed
  // `context + "\n" + text` (locked storage rule) so the vector carries the context while the
  // raw `text` stays separate for lexical search + display.
  const meta = await loader.loadMeta(ref);
  const transcriptText = transcript.segments.map((s) => s.text).join("\n");
  const built = chunkSegments(transcript.segments);
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

  // Provenance rides on the transcript; the pipeline never knows which STT service ran.
  const metadata: SourceProvenance = { provenance: transcript.provenance };
  if (transcript.sttProvider) metadata.sttProvider = transcript.sttProvider;

  // Atomic swap: upsert the source (hash included), replace its chunks. The new hash is only
  // durable once every replacement row is in — no window where the hash is ahead of the data.
  const result = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(sourceTable)
      .values({
        kind: meta.kind,
        externalId: meta.externalId,
        title: meta.title,
        url: meta.url,
        author: meta.author,
        publishedAt: meta.publishedAt,
        contentHash,
        metadata,
      })
      .onConflictDoUpdate({
        target: [sourceTable.kind, sourceTable.externalId],
        set: {
          title: meta.title,
          url: meta.url,
          author: meta.author,
          contentHash,
          metadata,
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

  return { status: "ingested", ref, sourceId: result.sourceId, title: meta.title, chunks: result.chunks };
}

/** A video is just a video: accepts a video ID or any YouTube URL, never widens to the channel. */
export function ingestVideo(input: string) {
  return ingestSource(
    { kind: "youtube_video", externalId: toVideoId(input) },
    youtubeLoader,
  );
}
