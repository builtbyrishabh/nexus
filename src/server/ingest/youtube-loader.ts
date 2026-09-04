import { YoutubeTranscript } from "youtube-transcript";

import type {
  LoadedSource,
  Segment,
  SourceRef,
} from "~/server/domain/types";

type OEmbed = { title?: string; author_name?: string };

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
    const videoId = ref.externalId;
    const [meta, transcript] = await Promise.all([
      fetchMeta(videoId),
      fetchTranscript(videoId),
    ]);

    const segments: Segment[] = transcript.map((t) => ({
      text: t.text,
      startSec: t.offset,
      endSec: t.offset + t.duration,
    }));

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
