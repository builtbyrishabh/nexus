import { describe, expect, it } from "vitest";

import { mergeNeighborText, neighborCoords } from "~/server/retrieval/neighbors";

describe("neighborCoords — which neighbors to fetch", () => {
  it("asks for ±radius around each hit", () => {
    const coords = neighborCoords([{ sourceId: "s1", chunkIndex: 5 }], 1);
    expect(coords).toEqual([
      { sourceId: "s1", index: 4 },
      { sourceId: "s1", index: 6 },
    ]);
  });

  it("never asks for a negative index", () => {
    const coords = neighborCoords([{ sourceId: "s1", chunkIndex: 0 }], 1);
    expect(coords).toEqual([{ sourceId: "s1", index: 1 }]);
  });

  it("skips a neighbor that is itself a hit (already its own Evidence)", () => {
    // Hits 5 and 6 are adjacent: 5's right neighbor and 6's left neighbor are each other.
    const coords = neighborCoords(
      [
        { sourceId: "s1", chunkIndex: 5 },
        { sourceId: "s1", chunkIndex: 6 },
      ],
      1,
    );
    // Only the outer edges (4 and 7) are fetched; the shared inner pair is dropped.
    expect(coords).toEqual([
      { sourceId: "s1", index: 4 },
      { sourceId: "s1", index: 7 },
    ]);
  });

  it("keys neighbors per source, so same index in different videos does not collide", () => {
    const coords = neighborCoords(
      [
        { sourceId: "s1", chunkIndex: 2 },
        { sourceId: "s2", chunkIndex: 2 },
      ],
      1,
    );
    expect(coords).toHaveLength(4);
    expect(coords).toContainEqual({ sourceId: "s2", index: 1 });
  });
});

describe("mergeNeighborText — widen the hit in reading order", () => {
  it("places neighbors before and after the hit", () => {
    expect(mergeNeighborText("before", "hit", "after")).toBe("before hit after");
  });

  it("drops missing or blank sides without leaving stray spaces", () => {
    expect(mergeNeighborText(undefined, "hit", "after")).toBe("hit after");
    expect(mergeNeighborText("before", "hit", "   ")).toBe("before hit");
    expect(mergeNeighborText(undefined, "hit", undefined)).toBe("hit");
  });
});
