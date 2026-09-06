import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
} from "youtube-transcript";
import { Innertube } from "youtubei.js";

import { env } from "~/env";
import type {
  Segment,
  SourceLoader,
  SourceMeta,
  SourceRef,
  Transcript,
} from "~/server/domain/types";
import { transcribeWithWhisper } from "~/server/ingest/whisper";
import {
  channelIdFromUrl,
  channelUrl,
  isChannelId,
  isVideoId,
  tryVideoId,
  watchUrl,
} from "~/server/ingest/youtube-url";

type OEmbed = { title?: string; author_name?: string };

type TranscriptEntry = { text: string; offset: number; duration: number };

/**
 * The youtube-transcript library reports offset/duration in milliseconds on its primary (srv3)
 * path but seconds on the classic fallback, with no flag telling us which. We combine two signals
 * to pick the unit, so no single degenerate track silently deep-links to `?t=0` or `?t=<huge>`:
 *   - a per-segment median duration above ~100 can only be milliseconds (a caption line lasts a
 *     few seconds), and
 *   - a max offset above 24h of *seconds* can only be milliseconds (no realistic video is that
 *     long) — this catches srv3 tracks whose durations are all 0/NaN, where the median signal is
 *     blind.
 * Either signal alone flips the track to ms; neither firing means it is already seconds. (The one
 * genuinely ambiguous shape a heuristic can't split — a classic-seconds track whose few cues each
 * run >100 s — is why the durable fix is to pin the caption format; tracked separately.)
 */
export function toSeconds(transcript: TranscriptEntry[]): Segment[] {
  const durations = transcript
    .map((t) => t.duration)
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations[Math.floor(durations.length / 2)]!
    : 0;
  const maxOffset = transcript.reduce((m, t) => Math.max(m, t.offset), 0);
  const looksLikeMs = median > 100 || maxOffset > 86_400;
  const divisor = looksLikeMs ? 1000 : 1;

  return transcript.map((t) => ({
    text: t.text,
    startSec: t.offset / divisor,
    endSec: (t.offset + t.duration) / divisor,
  }));
}

/**
 * One Innertube session per process, created lazily. `Innertube.create()` is a network round trip
 * (client config), so every discover/resolve call shares it rather than paying it again.
 */
let innertubeP: Promise<Innertube> | undefined;
function innertube(): Promise<Innertube> {
  return (innertubeP ??= Innertube.create());
}

/**
 * Resolve any channel reference — UC id, `@handle`, bare handle, channel URL (incl. legacy `/c/`),
 * or any video URL/id — to its UC channel id. No API key: a UC id or a `/channel/` URL is read
 * directly; a video resolves to its owner via the video's own info (the watch-page scrape this
 * replaced could return another channel's id); everything else goes through Innertube's URL
 * resolver, which is what the YouTube client itself uses.
 */
export async function resolveChannelId(input: string): Promise<string> {
  const raw = input.trim();
  if (isChannelId(raw)) return raw;
  const inUrl = channelIdFromUrl(raw);
  if (inUrl) return inUrl;

  const yt = await innertube();

  const videoId = tryVideoId(raw);
  if (videoId) {
    const id = (await yt.getBasicInfo(videoId)).basic_info.channel_id;
    if (!id || !isChannelId(id))
      throw new Error(`Could not resolve the channel of video ${videoId}`);
    return id;
  }

  const nav = await yt.resolveURL(channelUrl(raw));
  const id = nav.payload?.browseId as unknown;
  if (typeof id !== "string" || !isChannelId(id))
    throw new Error(`Could not resolve a channel id from: ${input}`);
  return id;
}

/** A page of a channel's Videos tab, whatever concrete Innertube class it comes back as. */
type VideoPage = {
  videos: readonly object[];
  has_continuation: boolean;
  getContinuation(): Promise<VideoPage>;
};

/** The video id off a Videos-tab item. Innertube has shipped two item shapes; accept both. */
function itemVideoId(item: object): string | undefined {
  const rec = item as { content_id?: unknown; id?: unknown };
  const id = rec.content_id ?? rec.id;
  return isVideoId(id as string) ? (id as string) : undefined;
}

/**
 * Every upload of a channel, newest first, paged through Innertube continuations until the tab is
 * exhausted (or `limit` is reached — the caller's cap, so an N-video run pays for N, not the whole
 * catalog). This is the "entire catalog" the product contract needs; the public RSS feed, which
 * would be simpler, stops at the newest ~15.
 */
async function* listUploads(
  channelId: string,
  limit?: number,
): AsyncGenerator<string> {
  const yt = await innertube();
  const channel = await yt.getChannel(channelId);
  let page: VideoPage = await channel.getVideos();
  let yielded = 0;

  while (true) {
    for (const item of page.videos) {
      const id = itemVideoId(item);
      if (!id) continue;
      yield id;
      if (limit !== undefined && ++yielded >= limit) return;
    }
    if (!page.has_continuation) return;
    page = await page.getContinuation();
  }
}

/**
 * Resolve human-readable video metadata without an API key via YouTube's public oEmbed
 * endpoint. Falls back to the videoId if unavailable.
 */
async function fetchMeta(
  videoId: string,
): Promise<{ title: string; author?: string }> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`,
    );
    if (!res.ok) return { title: videoId };
    const data = (await res.json()) as OEmbed;
    return { title: data.title ?? videoId, author: data.author_name };
  } catch {
    return { title: videoId };
  }
}

/** Captions are genuinely absent (vs. a transient/terminal failure we must not paper over). */
function isNoCaptionsError(err: unknown): boolean {
  return (
    err instanceof YoutubeTranscriptDisabledError ||
    err instanceof YoutubeTranscriptNotAvailableError
  );
}

/**
 * Fetch the transcript, preferring English. YouTube exposes many caption tracks (including
 * auto-translations), and the library's default can land on a non-English one — so we ask for
 * English first and fall back to the default track *only* when English specifically isn't
 * available. Any other error (rate limit, video unavailable, network) propagates unchanged.
 */
async function fetchTranscript(videoId: string) {
  try {
    return await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
  } catch (err) {
    if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
      return await YoutubeTranscript.fetchTranscript(videoId);
    }
    throw err;
  }
}

/**
 * Get a video's timestamped segments, preferring the (free, instant) caption track and falling
 * back to Whisper only when there is genuinely no caption track AND the fallback is enabled. The
 * two sources converge on the same `Segment[]`; the provenance travels with them so the pipeline
 * can persist it and never re-transcribe.
 *
 * "No caption track" is precise: the library's Disabled/NotAvailable errors, or a caption body
 * that parses to zero segments. Transient/terminal errors (rate limit, video unavailable, network)
 * are re-thrown — routing them to Whisper would fan a single YouTube rate-limit out into N paid
 * STT calls.
 */
async function loadTranscript(videoId: string): Promise<Transcript> {
  let segments: Segment[] = [];
  try {
    segments = toSeconds(await fetchTranscript(videoId));
  } catch (err) {
    if (!isNoCaptionsError(err)) throw err;
  }

  if (segments.length > 0) return { segments, provenance: "captions" };

  // Genuinely no captions.
  if (env.WHISPER_FALLBACK) {
    return { segments: await transcribeWithWhisper(videoId), provenance: "whisper" };
  }
  throw new Error(`No caption track for video ${videoId} (WHISPER_FALLBACK is off)`);
}

/**
 * SourceLoader for YouTube (docs/DESIGN.md §4a). `discover()` enumerates a channel's uploads;
 * `loadTranscript()` fetches one video's transcript and `loadMeta()` its title (kept separate so
 * an idempotent re-run can decide "unchanged" from the transcript hash without paying the metadata
 * request). Adding a new source (books) is a new loader behind this same shape.
 */
export const youtubeLoader = {
  /**
   * Enumerate a channel's uploads as SourceRefs, newest first, through to the end of the catalog
   * (or `limit`). `scope` accepts a UC id, an `@handle`, a bare handle, a channel URL, or any
   * video URL/id (resolved to its owner).
   */
  async *discover(
    scope: string,
    opts?: { limit?: number },
  ): AsyncIterable<SourceRef> {
    const channelId = await resolveChannelId(scope);
    for await (const externalId of listUploads(channelId, opts?.limit)) {
      yield { kind: "youtube_video", externalId };
    }
  },

  /** The transcript for one video. `ref.externalId` is canonical (the pipeline owns
   * `toVideoId`), so the loader trusts it rather than re-normalizing the same value twice. */
  loadTranscript(ref: SourceRef): Promise<Transcript> {
    return loadTranscript(ref.externalId);
  },

  /** Title/author/URL for one video. Fetched only when the pipeline has decided to write. */
  async loadMeta(ref: SourceRef): Promise<SourceMeta> {
    const meta = await fetchMeta(ref.externalId);
    return {
      kind: "youtube_video",
      externalId: ref.externalId,
      title: meta.title,
      url: watchUrl(ref.externalId),
      author: meta.author,
    };
  },
} satisfies SourceLoader;
