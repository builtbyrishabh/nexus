import { describe, expect, it } from "vitest";

import { deriveThreadTitle } from "~/lib/thread-title";

describe("deriveThreadTitle", () => {
  it("keeps a short question as-is, trimmed", () => {
    expect(deriveThreadTitle("  How do I price a service?  ")).toBe(
      "How do I price a service?",
    );
  });

  it("truncates a long question to 60 characters with an ellipsis", () => {
    const question =
      "What is the single most important lesson about pricing and value that shapes everything?";
    const title = deriveThreadTitle(question);

    expect(title.endsWith("…")).toBe(true);
    expect([...title].length).toBeLessThanOrEqual(61); // 60 chars + ellipsis
    expect(title).toBe(
      "What is the single most important lesson about pricing and v…",
    );
  });

  it("trims trailing whitespace before the ellipsis", () => {
    const question = `${"a".repeat(58)}   trailing`;
    expect(deriveThreadTitle(question)).toBe(`${"a".repeat(58)}…`);
  });
});
