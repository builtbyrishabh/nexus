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

  it("asks for stable citations without forcing a tool call or exact refusal", async () => {
    const instructions = await mastraModule.nexusAgent.getInstructions();
    expect(instructions).toEqual(expect.any(String));
    expect(instructions).toContain("[cite:<citationId>]");
    expect(instructions).not.toContain("EXACTLY ONCE");
    expect(instructions).not.toContain("refuse with exactly");
  });
});
