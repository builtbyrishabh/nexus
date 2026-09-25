import { describe, expect, it } from "vitest";

import { assertWithinCap, MAX_STT_MINUTES, toSegments } from "~/server/ingest/stt";

describe("STT duration cap", () => {
  it("rejects a known duration over the cap, names the cap", () => {
    expect(() => assertWithinCap("v", (MAX_STT_MINUTES + 1) * 60)).toThrow(/181 min.*180 min/);
  });

  it("passes at or under the cap, and when the duration is unknown", () => {
    expect(() => assertWithinCap("v", MAX_STT_MINUTES * 60)).not.toThrow();
    expect(() => assertWithinCap("v", 90)).not.toThrow();
    expect(() => assertWithinCap("v", undefined)).not.toThrow();
  });
});

describe("toSegments — words → sentence-sized segments", () => {
  const w = (text: string, start: number, end = start + 0.4) => ({
    text,
    startSecond: start,
    endSecond: end,
  });

  it("ends a segment on terminal punctuation and keeps first/last timing", () => {
    const segments = toSegments([w("Hi", 0), w("there.", 0.5, 1), w("Bye!", 2, 2.5), w("Trailing", 3, 3.4)]);
    expect(segments).toEqual([
      { text: "Hi there.", startSec: 0, endSec: 1 },
      { text: "Bye!", startSec: 2, endSec: 2.5 },
      { text: "Trailing", startSec: 3, endSec: 3.4 },
    ]);
  });

  it("caps a run-on sentence at 40 words", () => {
    const words = Array.from({ length: 100 }, (_, i) => w(`w${i}`, i));
    const segments = toSegments(words);
    expect(segments.map((s) => s.text.split(" ").length)).toEqual([40, 40, 20]);
    expect(segments[1]).toMatchObject({ startSec: 40, endSec: 79.4 });
  });

  it("handles no words", () => {
    expect(toSegments([])).toEqual([]);
  });
});
