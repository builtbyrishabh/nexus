import { describe, expect, it } from "vitest";

import { GOLDEN_SET, validateGolden, type GoldenCase } from "~/server/evals/golden";

describe("GOLDEN_SET", () => {
  it("passes its own integrity guard", () => {
    expect(() => validateGolden(GOLDEN_SET)).not.toThrow();
  });

  it("exercises both answerable and refusal behavior", () => {
    const refusals = GOLDEN_SET.filter((c) => c.expectRefusal).length;
    expect(refusals).toBeGreaterThan(0);
    expect(refusals).toBeLessThan(GOLDEN_SET.length);
  });
});

describe("validateGolden", () => {
  const ok: GoldenCase = { id: "a", query: "q?" };
  const refuse: GoldenCase = { id: "r", query: "q?", expectRefusal: true };

  it("rejects an empty set", () => {
    expect(() => validateGolden([])).toThrow(/empty/);
  });

  it("rejects duplicate ids", () => {
    expect(() => validateGolden([ok, refuse, { ...ok }])).toThrow(/duplicate/);
  });

  it("rejects an empty query", () => {
    expect(() => validateGolden([{ id: "x", query: "  " }, refuse])).toThrow(
      /empty query/,
    );
  });

  it("requires at least one refusal case", () => {
    expect(() => validateGolden([ok])).toThrow(/no refusal/);
  });

  it("requires at least one answerable case", () => {
    expect(() => validateGolden([refuse])).toThrow(/no answerable/);
  });
});
