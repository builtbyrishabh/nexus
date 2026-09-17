import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
  env: {
    DATABASE_URL: "postgresql://user:password@localhost:5432/nexus",
    GEN_MODEL: "openai/gpt-4.1-mini",
  },
}));

const mastraModule = await import("~/server/mastra");

describe("Nexus agent configuration", () => {
  it("uses one native memory instance with full thread recall", async () => {
    expect("nexusMemory" in mastraModule).toBe(true);

    const memory = await mastraModule.nexusAgent.getMemory();
    expect(memory).toBe(mastraModule.nexusMemory);
    expect(mastraModule.nexusMemory.getMergedThreadConfig().lastMessages).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("allows a 30-step agent-directed tool loop", () => {
    expect(mastraModule.NEXUS_MAX_STEPS).toBe(30);
  });

  it("sets a concise, natural, multi-search answer contract", async () => {
    const instructions = await mastraModule.nexusAgent.getInstructions();
    expect(instructions).toEqual(expect.any(String));
    expect(instructions).toContain("[cite:<citationId>]");
    expect(instructions).toContain("more than once");
    expect(instructions).not.toContain("exactly once");
    expect(instructions).toContain("complete citationId");
    expect(instructions).toContain("one to three short paragraphs");
    expect(instructions).toContain("under 150 words");
    expect(instructions).toContain("Synthesize the evidence");
    expect(instructions).toContain("non-null author");
    expect(instructions).toContain("Never imitate the creator");
  });
});
