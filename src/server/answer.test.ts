import { describe, expect, it } from "vitest";

import { buildAnswerMessages, isRefusal, refusalText } from "~/server/answer";
import type { Evidence } from "~/server/domain/types";

const evidence = (i: number): Evidence => ({
  chunkId: `c${i}`,
  sourceId: "s1",
  text: `chunk ${i} text`,
  score: 1,
  locator: { startSec: i * 60, endSec: i * 60 + 30 },
  source: { title: "Talk", url: "https://youtu.be/x" },
});

describe("buildAnswerMessages", () => {
  it("numbers evidence [1..n] so markers align with citations, and appends the question", () => {
    const [msg] = buildAnswerMessages("What did he say?", [evidence(1), evidence(2)]);
    expect(msg!.role).toBe("user");
    expect(msg!.content).toContain("[1] Talk");
    expect(msg!.content).toContain("[2] Talk");
    expect(msg!.content.indexOf("[1]")).toBeLessThan(msg!.content.indexOf("[2]"));
    expect(msg!.content).toContain("Question: What did he say?");
  });

  it("is byte-identical with no creator (home chat / eval path stays unchanged)", () => {
    const [scoped] = buildAnswerMessages("Q?", [evidence(1)]);
    const [unscoped] = buildAnswerMessages("Q?", [evidence(1)], undefined);
    expect(scoped!.content).toBe(unscoped!.content);
  });

  it("leads with a per-creator directive and that creator's refusal when scoped", () => {
    const [msg] = buildAnswerMessages("Q?", [evidence(1)], "Alex Hormozi");
    expect(msg!.content).toContain("Alex Hormozi's YouTube catalog");
    expect(msg!.content).toContain(refusalText("Alex Hormozi"));
    // The directive leads; the evidence packet still follows.
    expect(msg!.content.indexOf("Alex Hormozi")).toBeLessThan(
      msg!.content.indexOf("Evidence:"),
    );
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
