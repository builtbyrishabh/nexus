import { describe, expect, it } from "vitest";

import { toSegments } from "~/server/ingest/whisper";

describe("toSegments — Whisper segments → domain Segments", () => {
  it("maps start/end seconds straight through (no unit ambiguity, unlike captions)", () => {
    const whisper = [
      { text: "Hello there.", startSecond: 0, endSecond: 2.5 },
      { text: "General Kenobi.", startSecond: 2.5, endSecond: 4 },
    ];
    expect(toSegments(whisper)).toEqual([
      { text: "Hello there.", startSec: 0, endSec: 2.5 },
      { text: "General Kenobi.", startSec: 2.5, endSec: 4 },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(toSegments([])).toEqual([]);
  });
});
