import { Innertube, Log } from "youtubei.js";
import { YoutubeTranscript } from "youtube-transcript";

import { env } from "~/env";
import type {
  ChannelScope,
  Segment,
  SourceLoader,
  SourceMeta,
  SourceRef,
  Transcript,
} from "~/server/domain/types";
import {
  assertWithinCap,
  isNoCaptions,
  STT_PROVIDER,
  transcribeAudio,
} from "~/server/ingest/stt";

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
 * Fetch the captions, preferring English. YouTube exposes many caption tracks (including
 * auto-translations), and the library's default can land on a non-English one — so we ask
 * for English first and fall back to whatever the default track is if English is unavailable.
 *
 * Returns `undefined` only when captions genuinely do not exist (the STT trigger). Any other
 * failure — rate limit, private/removed, network — rethrows: that video is `failed`, and a
 * throttle can never turn into a paid transcription.
 */
async function fetchCaptions(videoId: string): Promise<Segment[] | undefined> {
  try {
    const entries = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }).catch(
      () => YoutubeTranscript.fetchTranscript(videoId),
    );
    const segments = toSeconds(entries);
    return segments.length > 0 ? segments : undefined;
  } catch (error) {
    if (isNoCaptions(error)) return undefined;
    throw error;
  }
}

/**
 * Innertube client for stream URLs. YouTube now demands a proof-of-origin token from the WEB,
 * MWEB, IOS and ANDROID clients: without one the CDN either refuses to hand out a URL or 403s
 * every byte past the first megabyte (measured). VISIONOS is the client that still serves a
 * complete audio stream token-free; if it stops, this constant is the one thing to change.
 */
const AUDIO_CLIENT = "VISIONOS";

/**
 * The paid path, in guard order: flag → known duration under the cap → download audio into
 * memory (AssemblyAI does not accept YouTube URLs) → one `transcribe()` call. Nothing is
 * downloaded until every guard has passed.
 */
async function sttTranscript(videoId: string): Promise<Transcript> {
  if (!env.TRANSCRIBE_FALLBACK) {
    throw new Error(
      `${videoId} has no captions; set TRANSCRIBE_FALLBACK=true to transcribe it (paid)`,
    );
  }
  const yt = await getInnertube();
  const info = await yt.getBasicInfo(videoId, { client: AUDIO_CLIENT });
  const durationSec = info.basic_info.duration;
  assertWithinCap(videoId, durationSec);

  console.error(
    `[stt] ${videoId}: no captions — transcribing ${Math.round((durationSec ?? 0) / 60)} min via ${STT_PROVIDER}`,
  );
  const stream = await info.download({ type: "audio", quality: "best", client: AUDIO_CLIENT });
  const audio = new Uint8Array(await new Response(stream).arrayBuffer());
  const segments = await transcribeAudio(audio);
  return { segments, provenance: "stt", sttProvider: STT_PROVIDER };
}

/** One Innertube session per process (it fetches YouTube's client config on create). */
let innertube: Promise<Innertube> | undefined;
function getInnertube() {
  Log.setLevel(Log.Level.NONE); // YouTube's parser warnings are noise for our purposes.
  return (innertube ??= Innertube.create());
}

/**
 * Turn a channel scope into a UC channel id, letting youtubei.js do the recognising:
 * a video (id/URL) resolves to its owner via `getBasicInfo`; a handle or channel URL goes
 * through YouTube's own `resolveURL`; anything else is taken as a channel id and validated by
 * `getChannel`. No hand-written channel-id parsing.
 */
async function resolveChannelId(scope: ChannelScope): Promise<string> {
  const yt = await getInnertube();
  const raw = scope.trim();

  let videoId: string | undefined;
  try {
    videoId = toVideoId(raw);
  } catch {
    /* not a video — fall through */
  }
  if (videoId) {
    const owner = (await yt.getBasicInfo(videoId)).basic_info.channel_id;
    if (!owner) throw new Error(`Could not resolve the channel of video ${videoId}`);
    return owner;
  }

  if (raw.startsWith("@") || /^https?:\/\//.test(raw)) {
    const url = raw.startsWith("@") ? `https://www.youtube.com/${raw}` : raw;
    const browseId = (await yt.resolveURL(url)).payload?.browseId as
      | string
      | undefined;
    if (!browseId) throw new Error(`Not a YouTube channel: ${scope}`);
    return browseId;
  }

  return raw;
}

/** The slice of youtubei.js's Channel / continuation objects that paging needs. */
type VideoFeed = {
  videos: readonly unknown[];
  has_continuation: boolean;
  getContinuation(): Promise<VideoFeed>;
};

/** SourceLoader for YouTube: discovery via Innertube, captions via youtube-transcript. */
export const youtubeLoader: SourceLoader = {
  async *discover(scope, { limit } = {}) {
    const yt = await getInnertube();
    const channel = await yt.getChannel(await resolveChannelId(scope));
    let feed: VideoFeed = await channel.getVideos();
    let yielded = 0;

    for (;;) {
      for (const item of feed.videos) {
        // Uploads arrive as LockupView (`content_id`) on current YouTube, Video (`video_id`) on
        // older layouts; both are identity only, which is all a SourceRef carries.
        const videoId = videoIdOf(item);
        if (!videoId) continue;
        if (limit !== undefined && yielded >= limit) return;
        yielded++;
        yield { kind: "youtube_video", externalId: videoId };
      }
      if (!feed.has_continuation) return;
      feed = await feed.getContinuation();
    }
  },

  async loadTranscript(ref): Promise<Transcript> {
    const videoId = toVideoId(ref.externalId);
    const segments = await fetchCaptions(videoId);
    return segments ? { segments, provenance: "captions" } : sttTranscript(videoId);
  },

  async loadMeta(ref): Promise<SourceMeta> {
    const videoId = toVideoId(ref.externalId);
    const meta = await fetchMeta(videoId);
    return {
      kind: "youtube_video",
      externalId: videoId,
      title: meta.title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: meta.author,
    };
  },
};

function videoIdOf(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  if ("content_id" in item && "content_type" in item) {
    return item.content_type === "VIDEO" ? String(item.content_id) : undefined;
  }
  if ("video_id" in item) return String(item.video_id);
  return undefined;
}
