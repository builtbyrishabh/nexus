import { describe, expect, it } from "vitest";

import { isRefusal, refusalText } from "~/server/answer";
import { buildEvidencePacket } from "~/server/domain/citations";
import type { Evidence } from "~/server/domain/types";

const evidence = (i: number): Evidence => ({
  chunkId: `c${i}`,
  sourceId: "s1",
  text: `chunk ${i} text`,
  score: 1,
  locator: { startSec: i * 60, endSec: i * 60 + 30 },
  source: { title: "Talk", url: "https://youtu.be/x" },
});

describe("buildEvidencePacket", () => {
  it("numbers evidence [1..n] in order so markers align with citations", () => {
    const packet = buildEvidencePacket([evidence(1), evidence(2)]);
    expect(packet).toContain("[1] Talk");
    expect(packet).toContain("[2] Talk");
    expect(packet.indexOf("[1]")).toBeLessThan(packet.indexOf("[2]"));
  });
});

describe("refusalText", () => {
  it("names the creator with a neutral pronoun, never inferred from the name", () => {
    expect(refusalText("Codie Sanchez")).toBe(
      "Codie Sanchez hasn't covered that in their videos.",
    );
  });

  it("falls back to a neutral sentence when unscoped", () => {
    expect(refusalText()).toBe("That isn't covered in these videos.");
  });
});

describe("isRefusal", () => {
  it("matches the creator's refusal regardless of case, whitespace, quotes, and trailing punctuation", () => {
    const r = refusalText("Alex Hormozi");
    expect(isRefusal(r, "Alex Hormozi")).toBe(true);
    expect(isRefusal(`  ${r}  `, "Alex Hormozi")).toBe(true);
    expect(isRefusal(r.toUpperCase(), "Alex Hormozi")).toBe(true);
    expect(isRefusal(`"${r}"`, "Alex Hormozi")).toBe(true);
    expect(
      isRefusal("Alex Hormozi hasn't covered that in their videos", "Alex Hormozi"),
    ).toBe(true); // no period
  });

  it("matches the neutral refusal on the unscoped path", () => {
    expect(isRefusal(refusalText())).toBe(true);
  });

  it("does not match one creator's refusal against another's name", () => {
    expect(isRefusal(refusalText("Naval Ravikant"), "Alex Hormozi")).toBe(false);
  });

  it("is false for a substantive answer", () => {
    expect(isRefusal("He studied calligraphy at Reed [1].", "Alex Hormozi")).toBe(false);
  });

  it("is false for a hedge that opens like the refusal but keeps going", () => {
    expect(
      isRefusal(
        "Alex Hormozi hasn't covered that in their videos directly, but he does say X [1].",
        "Alex Hormozi",
      ),
    ).toBe(false);
  });
});
