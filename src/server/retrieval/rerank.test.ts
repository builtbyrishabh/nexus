import { describe, expect, it } from "vitest";

import { mapRanking } from "~/server/retrieval/rerank";

describe("mapRanking", () => {
  const ids = ["a", "b", "c", "d"];

  it("maps reranked positions back to chunk ids, preserving the model's order", () => {
    // Model ranked doc 2 first, then doc 0 — a reordering RRF could not have produced.
    const ranking = [
      { originalIndex: 2, score: 0.9 },
      { originalIndex: 0, score: 0.4 },
    ];
    expect(mapRanking(ids, ranking)).toEqual([
      { id: "c", score: 0.9 },
      { id: "a", score: 0.4 },
    ]);
  });

  it("drops out-of-range indices instead of throwing", () => {
    const ranking = [
      { originalIndex: 1, score: 0.8 },
      { originalIndex: 99, score: 0.7 },
      { originalIndex: -1, score: 0.6 },
    ];
    expect(mapRanking(ids, ranking)).toEqual([{ id: "b", score: 0.8 }]);
  });

  it("returns nothing for an empty ranking", () => {
    expect(mapRanking(ids, [])).toEqual([]);
  });
});
