import { describe, expect, it, vi } from "vitest";

import { refusalText } from "~/server/answer";
import type { AskChunk, Evidence } from "~/server/domain/types";
import type { SearchCapture } from "~/server/mastra/search-tool";

// Mock the agent: no model call, no DB. The fake `stream` plays the role of the Mastra loop —
// it fills the request-scoped capture (as the real tool would) and emits fullStream chunks.
const stream = vi.fn();
vi.mock("~/server/mastra", () => ({ nexusAgent: { stream } }));

const { ask } = await import("~/server/ask");

const evidence: Evidence = {
  chunkId: "c1",
  sourceId: "s1",
  text: "chunk text",
  score: 1,
  locator: { startSec: 60, endSec: 90 },
  source: { title: "Talk", url: "https://youtu.be/x" },
};

/** Drive the fake stream: mutate the capture (as the tool does), then yield the given chunks. */
function fakeRun(mutate: (c: SearchCapture) => void, chunks: unknown[]) {
  stream.mockImplementation(
    async (_messages: unknown, options: { requestContext: { getRaw(k: string): unknown } }) => {
      const capture = options.requestContext.getRaw("capture") as SearchCapture;
      return {
        fullStream: (async function* () {
          for (const c of chunks) {
            if ((c as { type: string }).type === "tool-result") mutate(capture);
            yield c;
          }
        })(),
      };
    },
  );
}

const toolResult = { type: "tool-result", payload: { toolName: "searchCreatorCatalog" } };
const textDelta = (text: string) => ({ type: "text-delta", payload: { text } });

async function collect(gen: AsyncGenerator<AskChunk>): Promise<AskChunk[]> {
  const out: AskChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

const baseInput = {
  query: "q",
  channel: "web" as const,
  userId: "u",
  threadId: "t",
  collectionCreatorHandles: ["hormozi"],
};

describe("ask() orchestration", () => {
  it("emits citations from the tool result before any answer text, and streams only post-search text", () => {
    fakeRun(
      (c) => {
        c.outcome = "ok";
        c.evidence = [evidence];
        c.effectiveHandles = ["hormozi"];
      },
      [textDelta("PLANNING"), toolResult, textDelta("Hello"), textDelta(" world")],
    );

    return collect(ask({ ...baseInput })).then((chunks) => {
      // First chunk carries citations; the pre-search "PLANNING" delta is dropped.
      expect(chunks[0]!.citations).toHaveLength(1);
      expect(chunks[0]!.sources).toHaveLength(1);
      const text = chunks
        .map((c) => c.textDelta ?? "")
        .join("");
      expect(text).toBe("Hello world");
      expect(text).not.toContain("PLANNING");
    });
  });

  it("empty evidence yields citations then the neutral refusal, and ignores later model text", async () => {
    fakeRun(
      (c) => {
        c.outcome = "empty_evidence";
        c.evidence = [];
        c.effectiveHandles = ["hormozi", "naval"]; // >1 → neutral voice
      },
      [toolResult, textDelta("the model kept talking")],
    );

    const chunks = await collect(ask({ ...baseInput }));
    expect(chunks[0]!.citations).toEqual([]);
    const text = chunks.map((c) => c.textDelta ?? "").join("");
    expect(text).toBe(refusalText());
    expect(text).not.toContain("kept talking");
  });

  it("empty evidence scoped to one creator refuses in that creator's voice", async () => {
    fakeRun(
      (c) => {
        c.outcome = "empty_evidence";
        c.evidence = [];
        c.effectiveHandles = ["hormozi"];
      },
      [toolResult],
    );

    const chunks = await collect(ask({ ...baseInput }));
    const text = chunks.map((c) => c.textDelta ?? "").join("");
    expect(text).toBe(refusalText("Alex Hormozi"));
  });

  it("an invalid agent scope clarifies rather than refusing or broadening", async () => {
    fakeRun(
      (c) => {
        c.outcome = "invalid_scope";
        c.evidence = [];
        c.invalidHandles = ["naval"];
      },
      [toolResult],
    );

    const chunks = await collect(ask({ ...baseInput }));
    const text = chunks.map((c) => c.textDelta ?? "").join("");
    expect(text).toContain("Naval Ravikant");
    expect(text).not.toBe(refusalText());
  });

  it("a tool/provider error throws (operational), never a silent refusal", async () => {
    fakeRun(() => undefined, [
      { type: "tool-error", payload: { error: new Error("rerank provider down") } },
    ]);

    await expect(collect(ask({ ...baseInput }))).rejects.toThrow("rerank provider down");
  });
});
