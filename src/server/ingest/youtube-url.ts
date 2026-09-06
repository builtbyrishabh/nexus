/**
 * YouTube identity, written once. A video id is 11 URL-safe base64 chars; a channel id is "UC" +
 * 22 of them. Every regex that needs either is built from these fragments so the pattern can
 * never drift between callers. Pure and dependency-free: the loader and the Whisper fallback
 * both import from here, and neither imports the other.
 */

const VIDEO_ID = "[A-Za-z0-9_-]{11}";
const VIDEO_ID_RE = new RegExp(`^${VIDEO_ID}$`);
const VIDEO_PATH_RE = new RegExp(`^/(?:embed|shorts|live|v)/(${VIDEO_ID})`);

const CHANNEL_ID = "UC[A-Za-z0-9_-]{22}";
const CHANNEL_ID_RE = new RegExp(`^${CHANNEL_ID}$`);
const CHANNEL_URL_RE = new RegExp(`channel/(${CHANNEL_ID})`);

/** True iff `v` is a bare 11-char YouTube video id. The single owner of "is this a video id?". */
export function isVideoId(v: string | null | undefined): v is string {
  return !!v && VIDEO_ID_RE.test(v);
}

/** True iff `v` is a bare 24-char UC channel id (a UC-prefixed *handle* is not one). Deliberately
 * not a type predicate: callers pass strings, and a predicate would narrow the false branch to
 * `never`. */
export function isChannelId(v: string | null | undefined): boolean {
  return !!v && CHANNEL_ID_RE.test(v);
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

/** `toVideoId` that answers "is this a video ref?" instead of throwing. */
export function tryVideoId(input: string): string | undefined {
  try {
    return toVideoId(input);
  } catch {
    return undefined;
  }
}

/** The UC id embedded in a `/channel/UC…` URL, if any. */
export function channelIdFromUrl(input: string): string | undefined {
  return CHANNEL_URL_RE.exec(input)?.[1];
}

/** The channel URL for a channel id, `@handle`, bare handle, or full URL. */
export function channelUrl(input: string): string {
  const raw = input.trim();
  if (isChannelId(raw)) return `https://www.youtube.com/channel/${raw}`;
  if (/^https?:\/\//.test(raw)) return raw;
  return `https://www.youtube.com/${raw.startsWith("@") ? raw : `@${raw}`}`;
}
