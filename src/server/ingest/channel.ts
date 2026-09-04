import type { SourceRef } from "~/server/domain/types";
import { ingestVideo } from "~/server/ingest/pipeline";
import { youtubeLoader } from "~/server/ingest/youtube-loader";
import { mapPool } from "~/server/util/pool";

const VIDEO_CONCURRENCY = 3;

/** What happened to one video. `failed` isolates a bad video (e.g. no captions) from the run. */
export type VideoOutcome =
  | { videoId: string; status: "ingested" | "skipped"; title: string; chunks: number }
  | { videoId: string; status: "failed"; error: string };

export type ChannelIngestResult = {
  channel: string;
  discovered: number;
  ingested: number;
  skipped: number;
  failed: number;
  outcomes: VideoOutcome[];
};

/**
 * Ingest a whole channel: discover its uploads, then ingest each video with bounded concurrency,
 * reusing the same idempotent `ingestVideo` (unchanged transcripts are skipped, so re-runs are
 * cheap). One caption-less or malformed video fails in isolation and is reported — it never sinks
 * the batch. Outcomes come back in discovery order regardless of finish order (mapPool preserves
 * position), so a resumed/partial run reads cleanly.
 */
export async function ingestChannel(
  channel: string,
  opts?: {
    concurrency?: number;
    limit?: number;
    onProgress?: (outcome: VideoOutcome) => void;
  },
): Promise<ChannelIngestResult> {
  const refs: SourceRef[] = [];
  for await (const ref of youtubeLoader.discover(channel)) {
    refs.push(ref);
    if (opts?.limit && refs.length >= opts.limit) break;
  }

  const outcomes = await mapPool(
    refs,
    opts?.concurrency ?? VIDEO_CONCURRENCY,
    async (ref): Promise<VideoOutcome> => {
      try {
        const r = await ingestVideo(ref.externalId);
        const outcome: VideoOutcome = {
          videoId: ref.externalId,
          status: r.skipped ? "skipped" : "ingested",
          title: r.title,
          chunks: r.chunks,
        };
        opts?.onProgress?.(outcome);
        return outcome;
      } catch (err) {
        const outcome: VideoOutcome = {
          videoId: ref.externalId,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
        opts?.onProgress?.(outcome);
        return outcome;
      }
    },
  );

  return {
    channel,
    discovered: refs.length,
    ingested: outcomes.filter((o) => o.status === "ingested").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}
