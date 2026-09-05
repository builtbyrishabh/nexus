import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
} from "youtube-transcript";

import { env } from "~/env";
import type { Segment, SourceMeta, SourceRef } from "~/server/domain/types";
import { transcribeWithWhisper } from "~/server/ingest/whisper";

type OEmbed = { title?: string; author_name?: string };

// One rule per identity, written once. A YouTube video id is 11 URL-safe base64 chars; a channel
// id is "UC" + 22 of them. Every regex that needs either is built from these fragments so the
// pattern can never drift between the four places that used to hand-roll it.
const VIDEO_ID = "[A-Za-z0-9_-]{11}";
const VIDEO_ID_RE = new RegExp(`^${VIDEO_ID}$`);
const VIDEO_PATH_RE = new RegExp(`^/(?:embed|shorts|live|v)/(${VIDEO_ID})`);
const FEED_VIDEO_ID_RE = new RegExp(`<yt:videoId>(${VIDEO_ID})</yt:videoId>`, "g");

const CHANNEL_ID = "UC[A-Za-z0-9_-]{22}";
const CHANNEL_ID_RE = new RegExp(`^${CHANNEL_ID}$`);
const CHANNEL_URL_RE = new RegExp(`channel/(${CHANNEL_ID})`);
const CHANNEL_JSON_RE = new RegExp(`"channelId":"(${CHANNEL_ID})"`);

type TranscriptEntry = { text: string; offset: number; duration: number };

/** True iff `v` is a bare 11-char YouTube video id. The single owner of "is this a video id?". */
export function isVideoId(v: string | null | undefined): v is string {
  return !!v && VIDEO_ID_RE.test(v);
}

/** The canonical watch URL for a video id. The stored citation URL and every request URL that
 * points at a video are built from this one helper so they stay in lockstep. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Canonicalize any accepted YouTube input to its 11-character video ID. The rest of Nexus
 * (DB identity, oEmbed lookup, citation deep-links) keys off this single canonical form, so a
 * bare ID, a `watch?v=` URL, and a `youtu.be` short URL all resolve to one source. Anything
 * that isn't recognizably a YouTube video is rejected here rather than silently persisted.
 */
export function toVideoId(input: string): string {
  const raw = input.trim();

  // Bare video ID (YouTube IDs are 11 chars of the URL-safe base64 alphabet).
  if (isVideoId(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a YouTube video ID or URL: ${input}`);
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (isVideoId(id)) return id;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (isVideoId(v)) return v;
    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    const m = VIDEO_PATH_RE.exec(url.pathname);
    if (isVideoId(m?.[1])) return m[1];
  }

  throw new Error(`Could not extract a YouTube video ID from: ${input}`);
}

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
    .filter((d) => d > 0)
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
 * Pull a channel id out of a channel page's HTML. YouTube stamps it in several places; the
 * inline `"channelId":"UC…"` in the bootstrap JSON is the most reliable, with the canonical
 * `/channel/UC…` link as a fallback. Pure so it can be tested against a saved page fixture.
 *
 * Note: on a *watch* page the bootstrap JSON can list other channels' ids before the owner's, so
 * pass a channel ref (UC id / @handle / channel URL) rather than a video URL for a reliable result.
 */
export function extractChannelId(html: string): string | undefined {
  const json = CHANNEL_JSON_RE.exec(html);
  if (json) return json[1];
  const canonical = CHANNEL_URL_RE.exec(html);
  return canonical?.[1];
}

/**
 * Video ids from a channel uploads RSS feed, in feed order (newest first). The feed lists each
 * upload as `<yt:videoId>…</yt:videoId>`; we take those directly. Pure — tested against a feed
 * fixture. (The public feed carries the ~15 most recent uploads.)
 */
export function parseUploadsFeed(xml: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(FEED_VIDEO_ID_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) ids.push(m[1]!);
  return ids;
}

/** The channel URL to fetch for a channel id, `@handle`, bare handle, or full URL. */
export function channelUrl(input: string): string {
  const raw = input.trim();
  if (CHANNEL_ID_RE.test(raw)) return `https://www.youtube.com/channel/${raw}`;
  if (/^https?:\/\//.test(raw)) return raw;
  return `https://www.youtube.com/${raw.startsWith("@") ? raw : `@${raw}`}`;
}

/**
 * Resolve any channel reference (UC id, @handle, bare handle, or channel/video URL) to its UC
 * channel id — no API key needed. A UC id or a URL that already contains one short-circuits;
 * otherwise we fetch the page and read it out of the HTML.
 */
export async function resolveChannelId(input: string): Promise<string> {
  const raw = input.trim();
  if (CHANNEL_ID_RE.test(raw)) return raw;
  const inUrl = CHANNEL_URL_RE.exec(raw);
  if (inUrl) return inUrl[1]!;

  const res = await fetch(channelUrl(raw), {
    headers: { "accept-language": "en" },
  });
  if (!res.ok)
    throw new Error(`Could not fetch channel page for "${input}" (${res.status})`);
  const id = extractChannelId(await res.text());
  if (!id) throw new Error(`Could not resolve a channel id from: ${input}`);
  return id;
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
 * two sources converge on the same `Segment[]`, so the pipeline doesn't care which one answered.
 *
 * "No caption track" is precise: the library's Disabled/NotAvailable errors, or a caption body
 * that parses to zero segments. Transient/terminal errors (rate limit, video unavailable, network)
 * are re-thrown — routing them to Whisper would fan a single YouTube rate-limit out into N paid
 * STT calls, and Whisper text ≠ caption text would re-hash and re-embed the whole corpus next run.
 */
async function loadSegments(videoId: string): Promise<Segment[]> {
  let segments: Segment[] = [];
  try {
    segments = toSeconds(await fetchTranscript(videoId));
  } catch (err) {
    if (!isNoCaptionsError(err)) throw err;
  }

  if (segments.length > 0) return segments;

  // Genuinely no captions.
  if (env.WHISPER_FALLBACK) return transcribeWithWhisper(videoId);
  throw new Error(`No caption track for video ${videoId} (WHISPER_FALLBACK is off)`);
}

/**
 * SourceLoader for YouTube. Source-agnostic seam (docs/DESIGN.md §4a): `discover()` enumerates a
 * channel's uploads; `loadSegments()` fetches one video's transcript and `loadMeta()` its title
 * (kept separate so an idempotent re-run can decide "unchanged" from the transcript hash without
 * paying the metadata request). Adding a new source (books) is a new loader behind this same shape.
 */
export const youtubeLoader = {
  /**
   * Enumerate a channel's uploads as SourceRefs from the public uploads RSS feed — no API key.
   * `channel` accepts a UC id, an `@handle`, a bare handle, or a channel/video URL.
   */
  async *discover(channel: string): AsyncIterable<SourceRef> {
    const channelId = await resolveChannelId(channel);
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    );
    if (!res.ok)
      throw new Error(
        `Could not fetch uploads feed for ${channelId} (${res.status})`,
      );
    for (const externalId of parseUploadsFeed(await res.text())) {
      yield { kind: "youtube_video", externalId };
    }
  },

  /** The transcript segments for one video. `ref.externalId` is canonical (the pipeline owns
   * `toVideoId`), so the loader trusts it rather than re-normalizing the same value twice. */
  loadSegments(ref: SourceRef): Promise<Segment[]> {
    return loadSegments(ref.externalId);
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
};
