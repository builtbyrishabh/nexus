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
 * Group consecutive transcript segments into ~250-token chunks with ~15% overlap, carrying
 * the timestamp locator through the split (start = first segment, end = last segment). The
 * timestamp is the whole citation premise, so it must survive chunking — this is the one
 * non-trivial part of "naive" Slice 0 chunking.
 *
 * Segments arrive already normalized to seconds by their loader; unit correction is a
 * source-specific concern and lives at that boundary, not here.
 */
export function chunkSegments(rawSegments: Segment[]): BuiltChunk[] {
  const segments = rawSegments.filter((s) => s.text.trim().length > 0);
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
