"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import { AnswerText, citationsOf, textOf } from "~/app/_components/answer";
import { PANEL_LINEUP, creatorByHandle } from "~/server/domain/creators";
import type { NexusUIMessage } from "~/server/domain/ui";

/**
 * The Panel (Slice 4): one question, each creator's own grounded, cited answer side by side. Each
 * column is an independent `ask()` scoped to one creator (its `creatorHandle` rides in the request
 * body), so columns retrieve, cite, and refuse independently — markers never cross columns. It's
 * ephemeral (no threads/persistence) and reuses the same `/api/chat` path as the main chat.
 */
export default function PanelPage() {
  const [question, setQuestion] = useState("");
  // Each column registers its send fn and reports its status; the one question box fans out to all.
  const sendersRef = useRef(new Map<string, (q: string) => void>());
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  const register = useCallback((handle: string, send: (q: string) => void) => {
    sendersRef.current.set(handle, send);
  }, []);
  const reportStatus = useCallback((handle: string, status: string) => {
    setStatuses((prev) =>
      prev[handle] === status ? prev : { ...prev, [handle]: status },
    );
  }, []);

  const busy = Object.values(statuses).some(
    (s) => s === "submitted" || s === "streaming",
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    for (const send of sendersRef.current.values()) send(q);
    setQuestion("");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-semibold text-ink">Panel</h1>
          <p className="text-sm text-muted">
            Ask one question; hear each creator answer in their own words —
            grounded and cited to the second. Silence where they never covered it.
          </p>
        </header>

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask the panel a question…"
            disabled={busy}
            className="flex-1 rounded-xl border border-line bg-elevated px-4 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Ask
          </button>
        </form>

        <div className="grid flex-1 gap-4 md:grid-cols-3">
          {PANEL_LINEUP.map((handle) => (
            <CreatorColumn
              key={handle}
              handle={handle}
              displayName={creatorByHandle(handle)?.displayName ?? handle}
              register={register}
              reportStatus={reportStatus}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** One panel column: an `ask()` scoped to `handle`, rendering only the grounded answers. */
function CreatorColumn({
  handle,
  displayName,
  register,
  reportStatus,
}: {
  handle: string;
  displayName: string;
  register: (handle: string, send: (q: string) => void) => void;
  reportStatus: (handle: string, status: string) => void;
}) {
  const { messages, sendMessage, status } = useChat<NexusUIMessage>({
    id: handle, // distinct id so each column keeps its own conversation state
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { creatorHandle: handle }, // scopes this column's retrieval + refusal
    }),
  });

  useEffect(() => {
    register(handle, (q) => void sendMessage({ text: q }));
  }, [register, handle, sendMessage]);
  useEffect(() => reportStatus(handle, status), [reportStatus, handle, status]);

  const answers = messages.filter((m) => m.role === "assistant");

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-lg font-medium text-ink">{displayName}</h2>
      {answers.length === 0 ? (
        <p className="text-sm text-muted">
          {status === "streaming" || status === "submitted"
            ? "Thinking…"
            : "Awaiting the panel’s question."}
        </p>
      ) : (
        answers.map((message) => (
          <div
            key={message.id}
            className="rounded-xl bg-elevated px-3 py-2 text-ink"
          >
            <AnswerText text={textOf(message)} citations={citationsOf(message)} />
          </div>
        ))
      )}
    </section>
  );
}
