import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { AnswerText, citationRegistry } from "~/app/_components/answer";

const citation = {
  citationId: "chunk-1",
  text: "Evidence text",
  title: "Example video",
  url: "https://youtu.be/abc?t=65",
  startSec: 65,
  timestamp: "1:05",
};

function assistantMessage(id: string, output: unknown): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-searchCreatorCatalog",
        toolCallId: `call-${id}`,
        state: "output-available",
        input: { query: "pricing" },
        output,
      },
    ],
  };
}

describe("citationRegistry", () => {
  it("collects validated catalog evidence across assistant messages", () => {
    const messages: UIMessage[] = [
      assistantMessage("one", { evidence: [citation] }),
      assistantMessage("two", {
        evidence: [
          {
            citationId: "chunk-2",
            text: "More evidence",
            title: "Another video",
            url: "https://youtu.be/def?t=12",
            startSec: 12,
            timestamp: "0:12",
          },
        ],
      }),
    ];

    expect([...citationRegistry(messages).keys()]).toEqual(["chunk-1", "chunk-2"]);
  });

  it("ignores malformed tool output and keeps the first value for a citation id", () => {
    const changed = { ...citation, title: "Changed title" };
    const messages: UIMessage[] = [
      assistantMessage("malformed", { evidence: [{ nope: true }] }),
      assistantMessage("first", { evidence: [citation] }),
      assistantMessage("second", { evidence: [changed] }),
    ];

    expect(citationRegistry(messages).get("chunk-1")).toEqual(citation);
  });
});

describe("AnswerText", () => {
  it("renders a citation marker as a timestamp deep link", () => {
    const citations = new Map([[citation.citationId, citation]]);
    const html = renderToStaticMarkup(
      createElement(AnswerText, {
        text: "Charge more [cite:chunk-1].",
        citations,
      }),
    );

    expect(html).toContain('href="https://youtu.be/abc?t=65"');
    expect(html).toContain("[1:05]");
    expect(html).toContain('title="Example video"');
  });

  it("keeps unresolved markers visible as plain text", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerText, {
        text: "Unsupported [cite:missing] marker.",
        citations: new Map(),
      }),
    );

    expect(html).toContain("[cite:missing]");
    expect(html).not.toContain("<a");
  });
});
