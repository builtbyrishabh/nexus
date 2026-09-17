import { describe, expect, it, vi } from "vitest";
import { RequestContext } from "@mastra/core/request-context";

import type { NexusRequestContext } from "~/server/domain/source-library";

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

  it("requires trusted request context before generation", async () => {
    await expect(
      mastraModule.nexusAgent.generate("hello", { maxSteps: 1 }),
    ).rejects.toThrow("Request context validation failed");
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

  it("shows only the request's available creators in its instructions", async () => {
    const requestContext = new RequestContext<NexusRequestContext>();
    requestContext.set("userId", "user-1");
    requestContext.set("hasSources", true);
    requestContext.set("allowedCreators", [
      { handle: "alex", displayName: "Alex Hormozi" },
      { handle: "naval", displayName: "Naval Ravikant" },
    ]);

    const instructions = await mastraModule.nexusAgent.getInstructions({
      requestContext: requestContext as unknown as RequestContext,
    });

    expect(instructions).toContain("Alex Hormozi: alex");
    expect(instructions).toContain("Naval Ravikant: naval");
    expect(instructions).toContain("exact handle");
  });

  it("describes an empty source library", async () => {
    const requestContext = new RequestContext<NexusRequestContext>();
    requestContext.set("userId", "user-1");
    requestContext.set("hasSources", false);
    requestContext.set("allowedCreators", []);

    const instructions = await mastraModule.nexusAgent.getInstructions({
      requestContext: requestContext as unknown as RequestContext,
    });

    expect(instructions).toContain("source library is empty");
  });
});
