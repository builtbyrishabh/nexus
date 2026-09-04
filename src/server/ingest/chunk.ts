import { encode } from "gpt-tokenizer";

import type { Segment } from "~/server/domain/types";

export type BuiltChunk = {
  text: string;
  startSec?: number;
  endSec?: number;
  tokenCount: number;
};

const TARGET_TOKENS = 250; // 200–300 target (docs/ARCHITECTURE.md canonical settings)
const OVERLAP_TOKENS = 40; // ~15% overlap

/**
 * The youtube-transcript library reports offset/duration in milliseconds on its primary
 * (InnerTube) path but seconds on the classic fallback. Normalize to seconds by magnitude:
 * no real video runs past ~24h, so an offset above that must be milliseconds.
 */
function normalizeToSeconds(segments: Segment[]): Segment[] {
  const maxStart = segments.reduce((m, s) => Math.max(m, s.startSec ?? 0), 0);
  const looksLikeMs = maxStart > 86_400;
  if (!looksLikeMs) return segments;
  return segments.map((s) => ({
    text: s.text,
    startSec: s.startSec === undefined ? undefined : s.startSec / 1000,
    endSec: s.endSec === undefined ? undefined : s.endSec / 1000,
  }));
}

/**
 * Group consecutive transcript segments into ~250-token chunks with ~15% overlap, carrying
 * the timestamp locator through the split (start = first segment, end = last segment). The
 * timestamp is the whole citation premise, so it must survive chunking — this is the one
 * non-trivial part of "naive" Slice 0 chunking.
 */
export function chunkSegments(rawSegments: Segment[]): BuiltChunk[] {
  const segments = normalizeToSeconds(rawSegments).filter(
    (s) => s.text.trim().length > 0,
  );
  if (segments.length === 0) return [];

  const chunks: BuiltChunk[] = [];
  let cursor = 0;

  while (cursor < segments.length) {
    let tokens = 0;
    let end = cursor;
    const parts: string[] = [];

    while (end < segments.length && tokens < TARGET_TOKENS) {
      const seg = segments[end]!;
      parts.push(seg.text.trim());
      tokens += encode(seg.text).length;
      end++;
    }

    const first = segments[cursor]!;
    const last = segments[end - 1]!;
    const text = parts.join(" ").replace(/\s+/g, " ").trim();

    chunks.push({
      text,
      startSec:
        first.startSec === undefined ? undefined : Math.floor(first.startSec),
      endSec:
        last.endSec === undefined
          ? last.startSec === undefined
            ? undefined
            : Math.floor(last.startSec)
          : Math.floor(last.endSec),
      tokenCount: tokens,
    });

    if (end >= segments.length) break;

    // Step back by ~overlap tokens worth of segments for context continuity.
    let back = 0;
    let overlapTokens = 0;
    while (back < end - cursor - 1 && overlapTokens < OVERLAP_TOKENS) {
      overlapTokens += encode(segments[end - 1 - back]!.text).length;
      back++;
    }
    cursor = end - back;
  }

  return chunks;
}
