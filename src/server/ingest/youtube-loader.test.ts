import { describe, expect, it } from "vitest";

import { toSeconds, toVideoId } from "~/server/ingest/youtube-loader";

describe("toVideoId — one identity for URL or ID", () => {
  it("passes a bare 11-char video ID through", () => {
    expect(toVideoId("UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
  });

  it("extracts the ID from a watch URL (incl. extra params)", () => {
    expect(toVideoId("https://www.youtube.com/watch?v=UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
    expect(
      toVideoId("https://www.youtube.com/watch?v=UF8uR6Z6KLc&t=42s&list=abc"),
    ).toBe("UF8uR6Z6KLc");
  });

  it("extracts the ID from a youtu.be short URL", () => {
    expect(toVideoId("https://youtu.be/UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
    expect(toVideoId("https://youtu.be/UF8uR6Z6KLc?t=42")).toBe("UF8uR6Z6KLc");
  });

  it("handles embed / shorts / live URL forms", () => {
    expect(toVideoId("https://www.youtube.com/embed/UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
    expect(toVideoId("https://www.youtube.com/shorts/UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
  });

  it("rejects a value that is not a YouTube video", () => {
    expect(() => toVideoId("not a video")).toThrow();
    expect(() => toVideoId("https://example.com/watch?v=UF8uR6Z6KLc")).toThrow();
    expect(() => toVideoId("https://www.youtube.com/watch?v=too-short")).toThrow();
  });
});

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
});
