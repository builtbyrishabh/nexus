import { describe, expect, it } from "vitest";

import { rrfFuse } from "~/server/retrieval/rrf";

describe("rrfFuse — rank fusion without score normalization", () => {
  it("rewards agreement: an item in both lists beats each list's lone leader", () => {
    // "b" is #2 in both lists; "a" and "c" each top only one. Two rank-2s (2/62) outweigh a
    // single rank-1 (1/61), so consensus wins.
    const dense = ["a", "b"];
    const sparse = ["c", "b"];
    const fused = rrfFuse([dense, sparse]);
    expect(fused[0]?.id).toBe("b");
  });

  it("sums contributions only for the lists an item appears in", () => {
    const fused = rrfFuse([["a", "b"], ["a", "c"]], { k: 60 });
    const score = (id: string) => fused.find((f) => f.id === id)?.score ?? 0;
    // a: 1/61 + 1/61 ; b: 1/62 ; c: 1/62
    expect(score("a")).toBeCloseTo(2 / 61, 10);
    expect(score("b")).toBeCloseTo(1 / 62, 10);
    expect(score("a")).toBeGreaterThan(score("b"));
  });

  it("breaks ties by first appearance for a stable order", () => {
    // b and c never co-occur and sit at symmetric ranks → equal score; b seen first wins.
    const fused = rrfFuse([["a", "b"], ["a", "c"]]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("treats an empty list as a missing contributor, not an error", () => {
    const fused = rrfFuse([["a", "b"], []]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("returns nothing when every list is empty", () => {
    expect(rrfFuse([[], []])).toEqual([]);
  });

  it("a larger k flattens the gap between adjacent ranks", () => {
    const gap = (k: number) => {
      const f = rrfFuse([["a", "b"]], { k });
      return f[0]!.score - f[1]!.score;
    };
    expect(gap(60)).toBeLessThan(gap(1));
  });
});
