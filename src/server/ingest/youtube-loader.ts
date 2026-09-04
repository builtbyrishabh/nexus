import { YoutubeTranscript } from "youtube-transcript";

import { env } from "~/env";
import type {
  LoadedSource,
  Segment,
  SourceRef,
} from "~/server/domain/types";
import { transcribeWithWhisper } from "~/server/ingest/whisper";

type OEmbed = { title?: string; author_name?: string };

// A YouTube channel id: "UC" + 22 URL-safe base64 chars.
const CHANNEL_ID_RE = /UC[A-Za-z0-9_-]{22}/;

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
 * Pull a channel id out of a channel page's HTML. YouTube stamps it in several places; the
 * inline `"channelId":"UC…"` in the bootstrap JSON is the most reliable, with the canonical
 * `/channel/UC…` link as a fallback. Pure so it can be tested against a saved page fixture.
 */
export function extractChannelId(html: string): string | undefined {
  const json = /"channelId":"(UC[A-Za-z0-9_-]{22})"/.exec(html);
  if (json) return json[1];
  const canonical = new RegExp(`channel/(${CHANNEL_ID_RE.source})`).exec(html);
  return canonical?.[1];
}

/**
 * Video ids from a channel uploads RSS feed, in feed order (newest first). The feed lists each
 * upload as `<yt:videoId>…</yt:videoId>`; we take those directly. Pure — tested against a feed
 * fixture. (The public feed carries the ~15 most recent uploads; a full-catalog backfill would
 * page the uploads playlist via the Data API when `YOUTUBE_API_KEY` is set — same SourceRef seam.)
 */
export function parseUploadsFeed(xml: string): string[] {
  const ids: string[] = [];
  const re = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) ids.push(m[1]!);
  return ids;
}

/** The channel URL to fetch for a channel id, `@handle`, bare handle, or full URL. */
export function channelUrl(input: string): string {
  const raw = input.trim();
  if (CHANNEL_ID_RE.test(raw) && /^UC/.test(raw))
    return `https://www.youtube.com/channel/${raw}`;
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
  if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return raw;
  const inUrl = new RegExp(`channel/(${CHANNEL_ID_RE.source})`).exec(raw);
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
 * Get a video's timestamped segments, preferring the (free, instant) caption track and falling
 * back to Whisper only when there is no caption track AND the fallback is enabled. The two
 * sources converge on the same `Segment[]`, so `load()` doesn't care which one answered.
 */
async function loadSegments(videoId: string): Promise<Segment[]> {
  try {
    return toSeconds(await fetchTranscript(videoId));
  } catch (err) {
    if (!env.WHISPER_FALLBACK) throw err;
    return transcribeWithWhisper(videoId);
  }
}

/**
 * SourceLoader for YouTube. Source-agnostic seam (docs/DESIGN.md §4a): `discover()` enumerates a
 * channel's uploads, `load()` fetches one video's transcript + metadata. Adding a new source
 * (books) is a new loader behind this same shape, not a rewrite.
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

  async load(ref: SourceRef): Promise<LoadedSource> {
    // Defensive: callers pass a canonical ID, but re-normalize so the loader owns identity.
    const videoId = toVideoId(ref.externalId);
    const [meta, segments] = await Promise.all([
      fetchMeta(videoId),
      loadSegments(videoId),
    ]);

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
