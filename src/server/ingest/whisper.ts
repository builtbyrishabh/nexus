import ytdl from "@distube/ytdl-core";
import { experimental_transcribe as transcribe, gateway } from "ai";

import { env } from "~/env";
import type { Segment } from "~/server/domain/types";

/**
 * Whisper fallback: for videos with no caption track, transcribe the audio ourselves so they are
 * still ingestable (docs/ARCHITECTURE.md tags this 🟡 — it only earns its cost when captions are
 * absent). Off by default (`WHISPER_FALLBACK`); the loader calls it only after the caption fetch
 * fails. Kept in its own module so the caption path carries none of its weight.
 */

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

/** Collect a YouTube audio-only stream into a single buffer to hand to the STT model. */
async function fetchAudio(videoId: string): Promise<Buffer> {
  const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
    filter: "audioonly",
    quality: "highestaudio",
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
  const { segments } = await transcribe({
    model: gateway.transcriptionModel(env.WHISPER_MODEL),
    audio,
  });
  return toSegments(segments);
}
