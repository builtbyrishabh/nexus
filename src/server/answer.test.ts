import { describe, expect, it } from "vitest";

import { buildAnswerMessages, isRefusal, REFUSAL_TEXT } from "~/server/answer";
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
});

describe("isRefusal", () => {
  it("matches the canonical refusal regardless of case, whitespace, quotes, and trailing punctuation", () => {
    expect(isRefusal(REFUSAL_TEXT)).toBe(true);
    expect(isRefusal(`  ${REFUSAL_TEXT}  `)).toBe(true);
    expect(isRefusal(REFUSAL_TEXT.toUpperCase())).toBe(true);
    expect(isRefusal(`"${REFUSAL_TEXT}"`)).toBe(true);
    expect(isRefusal("He doesn't cover that in his videos")).toBe(true); // no period
  });

  it("is false for a substantive answer", () => {
    expect(isRefusal("He studied calligraphy at Reed [1].")).toBe(false);
  });

  it("is false for a hedge that opens like the refusal but keeps going", () => {
    expect(
      isRefusal("He doesn't cover that in his videos directly, but he does say X [1]."),
    ).toBe(false);
  });
});
