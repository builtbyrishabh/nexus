import { createAssemblyAI } from "@ai-sdk/assemblyai";
import { transcribe } from "ai";
import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
} from "youtube-transcript";

import { env } from "~/env";
import type { Segment, SttProvider } from "~/server/domain/types";

/**
 * Speech-to-text for caption-less videos. This file is the whole provider choice: swapping
 * AssemblyAI for another `transcribe()` provider touches nothing else. The decisions that
 * guard the bill (which caption failures may trigger a paid call, how long a video may be)
 * live here as pure functions so they are tested without any network.
 */

export const STT_PROVIDER: SttProvider = "assemblyai";
const STT_MODEL = "universal-3-5-pro";

/**
 * Cost cap. AssemblyAI bills per audio hour, so a 3-hour podcast costs ~10x a 20-minute
 * upload; anything longer than this fails before a byte is downloaded. A stream with no known
 * duration passes — the cap is for *known* runaway cases, and refusing every unknown would
 * silently drop ordinary uploads.
 */
export const MAX_STT_MINUTES = 180;

/**
 * The fallback trigger. Only "these captions genuinely do not exist" may lead to a paid
 * transcription: disabled by the owner, no track at all, or no track in a language we can use.
 * Everything else — rate limit, private/removed video, network — rethrows so the video is
 * `failed` and a throttle can never fan out into paid calls. Rerunning is the retry.
 */
export function isNoCaptions(error: unknown): boolean {
  return (
    error instanceof YoutubeTranscriptDisabledError ||
    error instanceof YoutubeTranscriptNotAvailableError ||
    error instanceof YoutubeTranscriptNotAvailableLanguageError
  );
}

export function assertWithinCap(videoId: string, durationSec: number | undefined): void {
  if (durationSec === undefined) return;
  const minutes = Math.round(durationSec / 60);
  if (minutes > MAX_STT_MINUTES) {
    throw new Error(
      `${videoId} is ${minutes} min, over the ${MAX_STT_MINUTES} min STT cap — not transcribing`,
    );
  }
}

type Word = { text: string; startSecond: number; endSecond: number };

/** Sentence-sized segments: end on terminal punctuation, or at this many words. */
const MAX_WORDS_PER_SEGMENT = 40;

/**
 * `transcribe()` returns word-level timing. Group words into sentence-sized segments so a
 * citation deep-links to the start of a sentence, not mid-word, and so the chunker sees the
 * same shape captions give it.
 */
export function toSegments(words: readonly Word[]): Segment[] {
  const segments: Segment[] = [];
  let run: Word[] = [];

  const flush = () => {
    if (run.length === 0) return;
    segments.push({
      text: run.map((w) => w.text).join(" "),
      startSec: run[0]!.startSecond,
      endSec: run[run.length - 1]!.endSecond,
    });
    run = [];
  };

  for (const word of words) {
    run.push(word);
    if (/[.?!]$/.test(word.text) || run.length >= MAX_WORDS_PER_SEGMENT) flush();
  }
  flush();
  return segments;
}

/** One paid call: bytes in, sentence segments out. */
export async function transcribeAudio(audio: Uint8Array): Promise<Segment[]> {
  const apiKey = env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY is not set; STT fallback needs it");
  const model = createAssemblyAI({ apiKey }).transcription(STT_MODEL);
  const result = await transcribe({ model, audio });
  return toSegments(result.segments);
}
