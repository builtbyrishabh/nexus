import ytdl from "@distube/ytdl-core";
import { gateway, transcribe } from "ai";

import { env } from "~/env";
import type { Segment } from "~/server/domain/types";
import { watchUrl } from "~/server/ingest/youtube-loader";

/**
 * Whisper fallback: for videos with no caption track, transcribe the audio ourselves so they are
 * still ingestable (docs/ARCHITECTURE.md tags this 🟡 — it only earns its cost when captions are
 * absent). Off by default (`WHISPER_FALLBACK`); the loader calls it only after the caption fetch
 * genuinely finds no track. Kept in its own module so the caption path carries none of its weight.
 */

// whisper-1 rejects uploads over 25 MB. At ~48 kbps (lowestaudio) that's ~70 min of speech, which
// covers the long uncaptioned talks this fallback exists for; past that we fail fast rather than
// download the whole file only to 413 at the API. (Splitting long audio into <25 MB pieces with
// offset timestamps is the next lever if it's ever needed — tracked separately.)
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Pure: AI SDK transcript segments → our `Segment[]`. Whisper already emits per-segment start/end
 * seconds, so — unlike the caption path — there is no ms/s ambiguity to normalize. This is the
 * seam that keeps the loader identical whether timestamps came from captions or from Whisper.
 */
export function toSegments(
  segments: readonly { text: string; startSecond: number; endSecond: number }[],
): Segment[] {
  return segments.map((s) => ({
    text: s.text,
    startSec: s.startSecond,
    endSec: s.endSecond,
  }));
}

/** Collect a YouTube audio-only stream into a single buffer to hand to the STT model. Lowest
 * bitrate on purpose: Whisper gains nothing from higher-quality audio, and it keeps us under the
 * 25 MB cap for far longer videos. */
async function fetchAudio(videoId: string): Promise<Buffer> {
  const stream = ytdl(watchUrl(videoId), {
    filter: "audioonly",
    quality: "lowestaudio",
  });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Transcribe a caption-less video to timestamped segments via the Gateway's STT model. The audio
 * download is the one fragile, network-heavy step; it stays behind this function and the
 * `WHISPER_FALLBACK` flag so nothing else in ingestion depends on it.
 */
export async function transcribeWithWhisper(videoId: string): Promise<Segment[]> {
  const audio = await fetchAudio(videoId);
  if (audio.byteLength > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio for ${videoId} is ${(audio.byteLength / 1_000_000).toFixed(1)} MB, over ` +
        `Whisper's 25 MB cap; skipping (splitting long audio is not yet supported).`,
    );
  }
  const { segments } = await transcribe({
    model: gateway.transcriptionModel(env.WHISPER_MODEL),
    audio,
  });
  return toSegments(segments);
}
