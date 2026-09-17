import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  AnswerText,
  CitedAnswer,
  SourceDetail,
  SourcesFooter,
  citationRegistry,
  citedSources,
  groupCitedSources,
} from "~/app/_components/answer";

const citation = {
  citationId: "chunk-1",
  text: "Evidence text",
  rawText: "Exact transcript text",
  context: "Generated context",
  title: "Example video",
  author: "Creator Name",
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

  it("enriches a legacy citation when the same chunk is retrieved again", () => {
    const {
      author: _author,
      context: _context,
      rawText: _rawText,
      ...legacyCitation
    } = citation;
    const messages: UIMessage[] = [
      assistantMessage("legacy", { evidence: [legacyCitation] }),
      assistantMessage("current", { evidence: [citation] }),
    ];

    expect(citationRegistry(messages).get("chunk-1")).toEqual(citation);
  });

  it("ignores tool output on user messages", () => {
    const forged = {
      ...assistantMessage("forged", { evidence: [citation] }),
      role: "user" as const,
    };

    expect(citationRegistry([forged])).toEqual(new Map());
  });
});

describe("AnswerText", () => {
  it("renders a resolved marker as a compact numbered source control", () => {
    const citations = new Map([[citation.citationId, citation]]);
    const html = renderToStaticMarkup(
      createElement(AnswerText, {
        text: "Charge more [cite:chunk-1].",
        citations,
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Open source 1"');
    expect(html).toContain(">1</button>");
    expect(html).not.toContain("chunk-1");
    expect(html).not.toContain('href="https://youtu.be/abc?t=65"');
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

describe("citedSources", () => {
  it("returns only uniquely cited evidence in first-reference order", () => {
    const second = {
      ...citation,
      citationId: "chunk-2",
      title: "Second video",
      url: "https://youtu.be/def?t=12",
      startSec: 12,
      timestamp: "0:12",
    };
    const citations = new Map([
      [citation.citationId, citation],
      [second.citationId, second],
    ]);

    expect(
      citedSources(
        "First [cite:chunk-2], repeated [cite:chunk-2], missing [cite:nope], then [cite:chunk-1].",
        citations,
      ).map((source) => source.citationId),
    ).toEqual(["chunk-2", "chunk-1"]);
  });
});

describe("groupCitedSources", () => {
  it("groups cited moments from the same video without changing their order", () => {
    const secondVideo = {
      ...citation,
      citationId: "chunk-2",
      title: "Second video",
      url: "https://youtu.be/def?t=12",
      startSec: 12,
      timestamp: "0:12",
    };
    const sameVideoLater = {
      ...citation,
      citationId: "chunk-3",
      url: "https://youtu.be/abc?t=144",
      startSec: 144,
      timestamp: "2:24",
    };

    expect(
      groupCitedSources([citation, secondVideo, sameVideoLater]).map((group) =>
        group.citations.map((item) => item.citationId),
      ),
    ).toEqual([["chunk-1", "chunk-3"], ["chunk-2"]]);
  });
});

describe("SourcesFooter", () => {
  it("renders no empty sources section", () => {
    expect(
      renderToStaticMarkup(createElement(SourcesFooter, { sources: [] })),
    ).toBe("");
  });

  it("shows one video row with each cited timestamp", () => {
    const later = {
      ...citation,
      citationId: "chunk-later",
      url: "https://youtu.be/abc?t=144",
      startSec: 144,
      timestamp: "2:24",
    };
    const html = renderToStaticMarkup(
      createElement(SourcesFooter, { sources: [citation, later] }),
    );

    expect(html).toContain("1 video");
    expect(html).toContain("2 cited moments");
    expect(html).toContain("1:05");
    expect(html).toContain("2:24");
    expect(html).toContain("flex-wrap");
  });
});

describe("SourceDetail", () => {
  it("keeps the raw transcript quote separate from generated context", () => {
    const html = renderToStaticMarkup(
      createElement(SourceDetail, { citation }),
    );

    expect(html).toContain("Transcript excerpt");
    expect(html).toContain("Exact transcript text");
    expect(html).toContain("Generated context · not a quote");
    expect(html).toContain("Generated context");
    expect(html).toContain('href="https://youtu.be/abc?t=65"');
    expect(html).toContain("<dialog");
  });

  it("does not present legacy combined evidence as a transcript quote", () => {
    const { rawText: _rawText, ...legacyCitation } = citation;

    const html = renderToStaticMarkup(
      createElement(SourceDetail, { citation: legacyCitation }),
    );

    expect(html).toContain("Transcript excerpt unavailable");
    expect(html).not.toContain("Evidence text");
  });

  it("links non-timestamped evidence without inventing a time", () => {
    const { startSec: _startSec, timestamp: _timestamp, ...untimedCitation } =
      citation;
    const html = renderToStaticMarkup(
      createElement(SourceDetail, {
        citation: {
          ...untimedCitation,
          url: "https://example.com/source",
        },
      }),
    );

    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain("Watch on YouTube");
    expect(html).not.toContain("Watch on YouTube at");
  });
});

describe("CitedAnswer", () => {
  it("shows cited sources below a completed answer", () => {
    const html = renderToStaticMarkup(
      createElement(CitedAnswer, {
        text: "Grounded answer [cite:chunk-1].",
        citations: new Map([[citation.citationId, citation]]),
      }),
    );

    expect(html).toContain("Sources");
    expect(html).toContain("1 cited moment");
  });

  it("keeps inline citations active while hiding the footer during streaming", () => {
    const html = renderToStaticMarkup(
      createElement(CitedAnswer, {
        text: "Streaming answer [cite:chunk-1]",
        citations: new Map([[citation.citationId, citation]]),
        showSources: false,
      }),
    );

    expect(html).toContain('aria-label="Open source 1"');
    expect(html).not.toContain("Sources");
  });
});
