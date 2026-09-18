import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Evidence } from "~/server/domain/types";
import type { NexusRequestContext } from "~/server/domain/source-library";

const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));

vi.mock("~/server/retrieval/retrieve", () => ({ retrieve: mocks.retrieve }));

const { searchCreatorCatalog } = await import("~/server/mastra/search-tool");

const evidence: Evidence[] = [
  {
    chunkId: "chunk-1",
    sourceId: "source-1",
    text: "Expanded transcript context.",
    excerpt: "The transcript text.",
    context: "Creator Name explains the idea.",
    score: 0.9,
    locator: { startSec: 65, endSec: 90 },
    source: {
      title: "Example video",
      url: "https://youtu.be/abc",
      author: "Creator Name",
    },
  },
  {
    chunkId: "chunk-2",
    sourceId: "source-2",
    text: "A book passage.",
    excerpt: "A book passage.",
    score: 0.8,
    source: {
      title: "Example book",
      url: "https://example.com/book",
      author: null,
    },
  },
];

function executionContext(
  allowedCreators = [{ handle: "creator", displayName: "Creator Name" }],
  hasSources = true,
) {
  const requestContext = new RequestContext<NexusRequestContext>();
  requestContext.set("userId", "user-1");
  requestContext.set("hasSources", hasSources);
  requestContext.set("allowedCreators", allowedCreators);
  return { requestContext } as Parameters<NonNullable<typeof searchCreatorCatalog.execute>>[1];
}

describe("searchCreatorCatalog", () => {
  it("rejects queries longer than 500 characters", () => {
    const schema = searchCreatorCatalog.inputSchema as unknown as z.ZodTypeAny;

    expect(schema.safeParse({ query: "x".repeat(501) }).success).toBe(false);
  });

  it("searches the user's full library when no creator is requested", async () => {
    mocks.retrieve.mockResolvedValue(evidence);
    const execute = searchCreatorCatalog.execute;
    if (!execute) throw new Error("search tool has no executor");

    const result = await execute({ query: "pricing advice" }, executionContext());

    expect(mocks.retrieve).toHaveBeenCalledWith("pricing advice", {
      userId: "user-1",
      topK: 5,
    });
    expect(result).toEqual({
      evidence: [
        {
          citationId: "chunk-1",
          text: "Context: Creator Name explains the idea.\nExpanded transcript context.",
          rawText: "The transcript text.",
          context: "Creator Name explains the idea.",
          title: "Example video",
          author: "Creator Name",
          url: "https://youtu.be/abc?t=65",
          startSec: 65,
          timestamp: "1:05",
        },
        {
          citationId: "chunk-2",
          text: "A book passage.",
          rawText: "A book passage.",
          title: "Example book",
          author: null,
          url: "https://example.com/book",
        },
      ],
    });
  });

  it("narrows an allowed creator without broadening source ownership", async () => {
    mocks.retrieve.mockResolvedValue([]);
    const execute = searchCreatorCatalog.execute;
    if (!execute) throw new Error("search tool has no executor");

    await execute(
      { query: "pricing advice", creatorHandle: "creator" },
      executionContext(),
    );

    expect(mocks.retrieve).toHaveBeenCalledWith("pricing advice", {
      userId: "user-1",
      creatorHandle: "creator",
      topK: 5,
    });
  });

  it("rejects a creator outside the user's library without searching", async () => {
    const execute = searchCreatorCatalog.execute;
    if (!execute) throw new Error("search tool has no executor");

    const result = await execute(
      { query: "pricing advice", creatorHandle: "someone-else" },
      executionContext(),
    );

    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(result).toEqual({
      evidence: [],
      message: "The creator 'someone-else' is not in your source library.",
    });
  });

  it("does not broaden an empty library into a global search", async () => {
    const execute = searchCreatorCatalog.execute;
    if (!execute) throw new Error("search tool has no executor");

    const result = await execute(
      { query: "pricing advice" },
      executionContext([], false),
    );

    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(result).toEqual({
      evidence: [],
      message: "Your source library is empty. Add a creator before searching it.",
    });
  });

  it("searches untagged member sources when no creator is requested", async () => {
    mocks.retrieve.mockResolvedValue([]);
    const execute = searchCreatorCatalog.execute;
    if (!execute) throw new Error("search tool has no executor");

    const result = await execute(
      { query: "pricing advice" },
      executionContext([], true),
    );

    expect(mocks.retrieve).toHaveBeenCalledWith("pricing advice", {
      userId: "user-1",
      topK: 5,
    });
    expect(result).toEqual({ evidence: [] });
  });
});
