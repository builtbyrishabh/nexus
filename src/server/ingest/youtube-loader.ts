import { YoutubeTranscript } from "youtube-transcript";

import type {
  LoadedSource,
  Segment,
  SourceRef,
} from "~/server/domain/types";

type OEmbed = { title?: string; author_name?: string };

type TranscriptEntry = { text: string; offset: number; duration: number };

/**
 * Canonicalize any accepted YouTube input to its 11-character video ID. The rest of Nexus
 * (DB identity, oEmbed lookup, citation deep-links) keys off this single canonical form, so a
 * bare ID, a `watch?v=` URL, and a `youtu.be` short URL all resolve to one source. Anything
 * that isn't recognizably a YouTube video is rejected here rather than silently persisted.
 */
export function toVideoId(input: string): string {
  const raw = input.trim();

  // Bare video ID (YouTube IDs are 11 chars of the URL-safe base64 alphabet).
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a YouTube video ID or URL: ${input}`);
  }

  const host = url.hostname.replace(/^www\./, "");
  const isId = (v: string | null | undefined): v is string =>
    !!v && /^[A-Za-z0-9_-]{11}$/.test(v);

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (isId(id)) return id;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (isId(v)) return v;
    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(
      url.pathname,
    );
    if (isId(m?.[1])) return m[1];
  }

  throw new Error(`Could not extract a YouTube video ID from: ${input}`);
}

/**
 * The youtube-transcript library reports offset/duration in milliseconds on its primary (srv3)
 * path but seconds on the classic fallback, with no flag telling us which. A single caption line
 * lasts a few seconds, so a typical per-segment duration above ~100 can only be milliseconds —
 * a discriminator that holds regardless of total video length (unlike a total-span heuristic,
 * which fails for short videos). Normalize to seconds here, at the YouTube boundary.
 */
export function toSeconds(transcript: TranscriptEntry[]): Segment[] {
  const durations = transcript
    .map((t) => t.duration)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations[Math.floor(durations.length / 2)]!
    : 0;
  const divisor = median > 100 ? 1000 : 1;

  return transcript.map((t) => ({
    text: t.text,
    startSec: t.offset / divisor,
    endSec: (t.offset + t.duration) / divisor,
  }));
}

/**
 * Resolve human-readable video metadata without an API key via YouTube's public oEmbed
 * endpoint. Falls back to the videoId if unavailable.
 */
async function fetchMeta(
  videoId: string,
): Promise<{ title: string; author?: string }> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (!res.ok) return { title: videoId };
    const data = (await res.json()) as OEmbed;
    return { title: data.title ?? videoId, author: data.author_name };
  } catch {
    return { title: videoId };
  }
}

/**
 * Fetch the transcript, preferring English. YouTube exposes many caption tracks (including
 * auto-translations), and the library's default can land on a non-English one — so we ask
 * for English first and fall back to whatever the default track is if English is unavailable.
 */
async function fetchTranscript(videoId: string) {
  try {
    return await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
  } catch {
    return await YoutubeTranscript.fetchTranscript(videoId);
  }
}

/**
 * SourceLoader for YouTube. Source-agnostic seam: Slice 3 adds full-channel `discover()`
 * and a Whisper fallback behind this same interface.
 */
export const youtubeLoader = {
  /** Slice 0 stub: yields the single ref it is handed (real channel discovery is Slice 3). */
  async *discover(refs: SourceRef[]): AsyncIterable<SourceRef> {
    for (const ref of refs) yield ref;
  },

  async load(ref: SourceRef): Promise<LoadedSource> {
    // Defensive: callers pass a canonical ID, but re-normalize so the loader owns identity.
    const videoId = toVideoId(ref.externalId);
    const [meta, transcript] = await Promise.all([
      fetchMeta(videoId),
      fetchTranscript(videoId),
    ]);

    const segments = toSeconds(transcript);

    return {
      source: {
        kind: "youtube_video",
        externalId: videoId,
        title: meta.title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        author: meta.author,
      },
      segments,
    };
  },
};
