import { describe, expect, it } from "vitest";

import { contextPrompt } from "~/server/ingest/contextualize";

describe("contextPrompt", () => {
  it("puts the title inside the document so title-only framing reaches the blurb", () => {
    const prompt = contextPrompt(
      { title: "My Actual Social Media Strategy For 2027", text: "the five steps of the algorithm" },
      "step one is question the requirements",
    );
    const doc = prompt.slice(prompt.indexOf("<document>"), prompt.indexOf("</document>"));
    expect(doc).toContain("Title: My Actual Social Media Strategy For 2027");
    expect(doc).toContain("the five steps of the algorithm");
    expect(prompt.indexOf("<document>")).toBe(0); // document first: shared prefix per video
    expect(prompt).toContain("step one is question the requirements");
  });
});
