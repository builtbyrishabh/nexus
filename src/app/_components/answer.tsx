"use client";

import type { NexusUIMessage } from "~/server/domain/ui";
import type { Citation } from "~/server/domain/types";

/** The citations attached to a message (the `data-citations` part), or none. */
export function citationsOf(message: NexusUIMessage): Citation[] {
  for (const part of message.parts) {
    if (part.type === "data-citations") return part.data;
  }
  return [];
}

/** The assistant/user text of a message, concatenated from its text parts. */
export function textOf(message: NexusUIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
}

/**
 * Render assistant text, turning inline [n] markers into timestamped deep-links.
 */
export function AnswerText({
  text,
  citations,
}: {
  text: string;
  citations: Citation[];
}) {
  const nodes = text.split(/(\[\d+\])/g).map((piece, i) => {
    const m = /^\[(\d+)\]$/.exec(piece);
    if (!m) return <span key={i}>{piece}</span>;
    const idx = Number(m[1]) - 1;
    const cite = citations[idx];
    if (!cite) return null; // drop out-of-range markers
    const label = cite.timestamp ? `[${cite.timestamp}]` : `[${idx + 1}]`;
    return (
      <a
        key={i}
        href={cite.deepLink ?? cite.url}
        target="_blank"
        rel="noreferrer"
        className="mx-0.5 rounded bg-accent-soft px-1 font-medium text-accent-ink no-underline hover:opacity-80"
        title={cite.sourceTitle}
      >
        {label}
      </a>
    );
  });
  return <p className="whitespace-pre-wrap leading-relaxed">{nodes}</p>;
}
