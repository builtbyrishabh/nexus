import ytdl from "@distube/ytdl-core";
import { gateway, transcribe } from "ai";

import { env } from "~/env";
import type { Segment } from "~/server/domain/types";
import { watchUrl } from "~/server/ingest/youtube-url";

/**
 * Whisper fallback: for videos with no caption track, transcribe the audio ourselves so they are
 * still ingestable (docs/ARCHITECTURE.md tags this 🟡 — it only earns its cost when captions are
 * absent). Off by default (`WHISPER_FALLBACK`); the loader calls it only after the caption fetch
 * genuinely finds no track. This module never imports the loader, so the caption path and the
 * fallback stay independent (both depend only on the pure `youtube-url` helpers).
 */

// whisper-1 rejects uploads over 25 MB. At ~48 kbps (lowestaudio) that's ~70 min of speech, which
// covers the long uncaptioned talks this fallback exists for. Past that we fail before paying for
// the download: the declared `contentLength` is checked up front, and the byte count is checked
// again while streaming for formats that don't declare one. (Splitting long audio into <25 MB
// pieces with offset timestamps is the next lever if it's ever needed — tracked separately.)
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

function tooLarge(videoId: string, bytes: number): Error {
  return new Error(
    `Audio for ${videoId} is ${(bytes / 1_000_000).toFixed(1)} MB, over Whisper's 25 MB cap; ` +
      `skipping (splitting long audio is not yet supported).`,
  );
}

/**
 * Collect a YouTube audio-only stream into a single buffer to hand to the STT model. Lowest
 * bitrate on purpose: Whisper gains nothing from higher-quality audio, and it keeps us under the
 * 25 MB cap for far longer videos. Fails before/while downloading, never after.
 */
async function fetchAudio(videoId: string): Promise<Buffer> {
  const info = await ytdl.getInfo(watchUrl(videoId));
  const format = ytdl.chooseFormat(info.formats, {
    filter: "audioonly",
    quality: "lowestaudio",
  });

  // Declared size, when the format carries one (progressive formats do; some adaptive ones don't).
  const declared = Number(format.contentLength) || 0;
  if (declared > WHISPER_MAX_BYTES) throw tooLarge(videoId, declared);

  const stream = ytdl.downloadFromInfo(info, { format });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > WHISPER_MAX_BYTES) {
      stream.destroy();
      throw tooLarge(videoId, total);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Transcribe a caption-less video to timestamped segments via the Gateway's STT model. The audio
 * download is the one fragile, network-heavy step; it stays behind this function and the
 * `WHISPER_FALLBACK` flag so nothing else in ingestion depends on it.
 */
export async function transcribeWithWhisper(videoId: string): Promise<Segment[]> {
  const audio = await fetchAudio(videoId);
  const { segments } = await transcribe({
    model: gateway.transcriptionModel(env.WHISPER_MODEL),
    audio,
  });
  return toSegments(segments);
}
