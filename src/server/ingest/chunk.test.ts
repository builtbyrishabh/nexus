import { describe, expect, it } from "vitest";

import type { Segment } from "~/server/domain/types";
import { chunkSegments } from "~/server/ingest/chunk";

describe("chunkSegments — timestamps survive chunking", () => {
  it("carries the first/last locator through a chunk, in seconds", () => {
    const segments: Segment[] = [
      { text: "hello world", startSec: 0, endSec: 3 },
      { text: "this is nexus", startSec: 3, endSec: 6 },
      { text: "grounded answers", startSec: 6, endSec: 9 },
    ];
    const [chunk] = chunkSegments(segments);
    expect(chunk?.startSec).toBe(0);
    expect(chunk?.endSec).toBe(9);
    expect(chunk?.text).toContain("hello world");
  });

  it("does not second-guess units — 9s of seconds stays 9s", () => {
    const segments: Segment[] = [
      { text: "a", startSec: 0, endSec: 3 },
      { text: "b", startSec: 6, endSec: 9 },
    ];
    const [chunk] = chunkSegments(segments);
    // A prior magnitude heuristic could not run here anyway, but assert the contract:
    // the chunker treats inputs verbatim as seconds.
    expect(chunk?.endSec).toBe(9);
  });

  it("drops empty segments", () => {
    const segments: Segment[] = [
      { text: "   ", startSec: 0, endSec: 1 },
      { text: "real", startSec: 1, endSec: 2 },
    ];
    const [chunk] = chunkSegments(segments);
    expect(chunk?.text).toBe("real");
  });
});
