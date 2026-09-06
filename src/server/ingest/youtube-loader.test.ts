import { describe, expect, it } from "vitest";

import { toSeconds } from "~/server/ingest/youtube-loader";

describe("toSeconds — unit normalization at the boundary", () => {
  it("passes through a normal-length transcript already in seconds (classic format)", () => {
    // Classic <text start="s" dur="s"> path: values are seconds.
    const transcript = [
      { text: "a", offset: 0, duration: 3.2 },
      { text: "b", offset: 3.2, duration: 2.8 },
      { text: "c", offset: 6, duration: 4 },
    ];
    const segments = toSeconds(transcript);
    expect(segments[0]).toEqual({ text: "a", startSec: 0, endSec: 3.2 });
    expect(segments[2]).toEqual({ text: "c", startSec: 6, endSec: 10 });
  });

  it("normalizes a SHORT millisecond transcript (the regression: total span < 86_400)", () => {
    // srv3 <p t="ms"> path on a ~9s clip. Total span never crosses a max-span threshold,
    // but per-segment durations (~3000ms) reveal the ms unit.
    const transcript = [
      { text: "a", offset: 0, duration: 3000 },
      { text: "b", offset: 3000, duration: 3000 },
      { text: "c", offset: 6000, duration: 3000 },
    ];
    const segments = toSeconds(transcript);
    expect(segments[0]).toEqual({ text: "a", startSec: 0, endSec: 3 });
    expect(segments[2]).toEqual({ text: "c", startSec: 6, endSec: 9 });
  });

  it("normalizes a long millisecond transcript", () => {
    const transcript = [
      { text: "a", offset: 0, duration: 4000 },
      { text: "b", offset: 600_000, duration: 4000 }, // 10 min in
    ];
    const segments = toSeconds(transcript);
    expect(segments[1]).toEqual({ text: "b", startSec: 600, endSec: 604 });
  });

  it("uses the max-offset signal when every duration is zero (srv3 with blank d)", () => {
    // Durations all 0/NaN → the median signal is blind; a 20-min offset in ms (1_200_000) can
    // only be milliseconds (that's 13+ days of seconds), so it must still normalize to seconds.
    const transcript = [
      { text: "a", offset: 0, duration: 0 },
      { text: "b", offset: 1_200_000, duration: 0 }, // 20 min in, in ms
    ];
    const segments = toSeconds(transcript);
    expect(segments[1]).toEqual({ text: "b", startSec: 1200, endSec: 1200 });
  });
});
