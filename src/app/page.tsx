"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

import type { NexusUIMessage } from "~/server/domain/ui";
import type { Citation } from "~/server/domain/types";

function citationsOf(message: NexusUIMessage): Citation[] {
  for (const part of message.parts) {
    if (part.type === "data-citations") return part.data;
  }
  return [];
}

/** Render assistant text, turning inline [n] markers into timestamped deep-links. */
function AnswerText({
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
        className="mx-0.5 rounded bg-indigo-500/20 px-1 text-indigo-300 hover:bg-indigo-500/40"
        title={cite.sourceTitle}
      >
        {label}
      </a>
    );
  });
  return <p className="whitespace-pre-wrap leading-relaxed">{nodes}</p>;
}

export default function HomePage() {
  const { messages, sendMessage, status } = useChat<NexusUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Nexus</h1>
        <p className="text-sm text-white/60">
          Ask about the ingested video. Answers are grounded and cited to the
          second.
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-4">
        {messages.map((message) => {
          const text = message.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join("");
          const citations = citationsOf(message);
          return (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "self-end rounded-lg bg-white/10 px-3 py-2"
                  : "self-start rounded-lg bg-indigo-500/10 px-3 py-2"
              }
            >
              {message.role === "assistant" ? (
                <AnswerText text={text} citations={citations} />
              ) : (
                <p className="whitespace-pre-wrap">{text}</p>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && status === "ready") {
            sendMessage({ text: input });
            setInput("");
          }
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          disabled={status !== "ready"}
          className="flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-2 outline-none focus:border-indigo-400"
        />
        <button
          type="submit"
          disabled={status !== "ready" || !input.trim()}
          className="rounded-lg bg-indigo-500 px-4 py-2 font-medium disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </main>
  );
}
