"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";

import {
  catalogSearchResultSchema,
  type CatalogEvidence,
} from "~/server/domain/citations";

/** Index completed native search-tool outputs once for the whole conversation. */
export function citationRegistry(
  messages: UIMessage[],
): ReadonlyMap<string, CatalogEvidence> {
  const citations = new Map<string, CatalogEvidence>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== "searchCreatorCatalog" ||
        part.state !== "output-available"
      ) {
        continue;
      }

      const result = catalogSearchResultSchema.safeParse(part.output);
      if (!result.success) continue;
      for (const evidence of result.data.evidence) {
        if (!citations.has(evidence.citationId)) {
          citations.set(evidence.citationId, evidence);
        }
      }
    }
  }

  return citations;
}

/** The assistant/user text of a native AI SDK message. */
export function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Render stable citation IDs as source links while leaving ordinary prose untouched. */
export function AnswerText({
  text,
  citations,
}: {
  text: string;
  citations: ReadonlyMap<string, CatalogEvidence>;
}) {
  const nodes = text.split(/(\[cite:[^\]\s]+\])/g).map((piece, index) => {
    const marker = /^\[cite:([^\]\s]+)\]$/.exec(piece);
    if (!marker) return <span key={index}>{piece}</span>;

    const citation = citations.get(marker[1]!);
    if (!citation) return <span key={index}>{piece}</span>;

    return (
      <a
        key={index}
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        className="mx-0.5 rounded bg-accent-soft px-1 font-medium text-accent-ink no-underline hover:opacity-80"
        title={citation.title}
      >
        {citation.timestamp ? `[${citation.timestamp}]` : "[source]"}
      </a>
    );
  });

  return <p className="whitespace-pre-wrap leading-relaxed">{nodes}</p>;
}
