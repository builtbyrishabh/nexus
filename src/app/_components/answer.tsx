"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

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
    if (message.role !== "assistant") continue;
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
        const existing = citations.get(evidence.citationId);
        if (!existing) {
          citations.set(evidence.citationId, evidence);
          continue;
        }

        citations.set(evidence.citationId, {
          ...existing,
          rawText: existing.rawText ?? evidence.rawText,
          context: existing.context ?? evidence.context,
          author: existing.author ?? evidence.author,
        });
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

/** Resolve only the unique evidence IDs actually referenced by one answer. */
export function citedSources(
  text: string,
  citations: ReadonlyMap<string, CatalogEvidence>,
): CatalogEvidence[] {
  const sources: CatalogEvidence[] = [];
  const seen = new Set<string>();

  for (const marker of text.matchAll(/\[cite:([^\]\s]+)\]/g)) {
    const citationId = marker[1]!;
    if (seen.has(citationId)) continue;
    const citation = citations.get(citationId);
    if (!citation) continue;
    seen.add(citationId);
    sources.push(citation);
  }

  return sources;
}

export type CitedSourceGroup = {
  key: string;
  title: string;
  author?: string | null;
  citations: CatalogEvidence[];
};

/** Group multiple cited moments from the same source while preserving answer order. */
export function groupCitedSources(
  citations: CatalogEvidence[],
): CitedSourceGroup[] {
  const groups = new Map<string, CitedSourceGroup>();

  for (const citation of citations) {
    const url = new URL(citation.url);
    url.searchParams.delete("t");
    const key = url.toString();
    const group = groups.get(key);
    if (group) {
      group.citations.push(citation);
      continue;
    }
    groups.set(key, {
      key,
      title: citation.title,
      author: citation.author,
      citations: [citation],
    });
  }

  return [...groups.values()];
}

/** Compact, cited-only source list shown below one completed answer. */
export function SourcesFooter({
  sources,
  onSourceClick,
}: {
  sources: CatalogEvidence[];
  onSourceClick?: (citation: CatalogEvidence) => void;
}) {
  if (sources.length === 0) return null;
  const groups = groupCitedSources(sources);

  return (
    <footer className="mt-4 border-t border-line pt-3">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
        <span>Sources</span>
        <span className="font-normal text-muted">
          {groups.length} {groups.length === 1 ? "video" : "videos"} ·{" "}
          {sources.length} cited {sources.length === 1 ? "moment" : "moments"}
        </span>
      </div>
      <div className="space-y-1">
        {groups.map((group) => (
          <div
            key={group.key}
            className="grid grid-cols-1 items-center gap-2 rounded-lg px-2 py-2 hover:bg-canvas sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <button
              type="button"
              onClick={() => onSourceClick?.(group.citations[0]!)}
              className="min-w-0 border-0 bg-transparent p-0 text-left"
            >
              <span className="block truncate text-xs font-medium">
                {group.title}
              </span>
              {group.author && (
                <span className="mt-0.5 block text-xs text-muted">
                  {group.author} · YouTube
                </span>
              )}
            </button>
            <span className="flex flex-wrap gap-1 sm:justify-end">
              {group.citations.map((citation) => (
                <button
                  key={citation.citationId}
                  type="button"
                  onClick={() => onSourceClick?.(citation)}
                  className="rounded-md border-0 bg-accent-soft px-1.5 py-1 text-xs font-semibold text-accent-ink"
                  aria-label={`Open ${group.title} at ${citation.timestamp ?? "source"}`}
                >
                  {citation.timestamp ?? "Source"}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </footer>
  );
}

/** Responsive source detail: right drawer on desktop, bottom sheet on small screens. */
export function SourceDetail({
  citation,
  onClose,
}: {
  citation: CatalogEvidence;
  onClose?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`source-${citation.citationId}`}
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/30"
      onCancel={(event) => {
        if (!onClose) return;
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside
        className="fixed inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-elevated shadow-2xl sm:inset-y-0 sm:left-auto sm:w-full sm:max-w-md sm:rounded-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" />
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Cited source
            </p>
            <h2
              id={`source-${citation.citationId}`}
              className="mt-1 text-base font-semibold leading-snug text-ink"
            >
              {citation.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="grid size-9 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-xl text-muted hover:bg-surface hover:text-ink"
            aria-label="Close source details"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-5 pb-6 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-4 text-sm text-muted">
            <span>{citation.author ?? "Unknown creator"}</span>
            {citation.timestamp && (
              <span className="font-semibold text-accent-ink">
                {citation.timestamp}
              </span>
            )}
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Transcript excerpt
          </h3>
          {citation.rawText ? (
            <blockquote className="border-l-2 border-accent pl-4 text-sm leading-relaxed text-ink">
              {citation.rawText}
            </blockquote>
          ) : (
            <p className="text-sm text-muted">
              Transcript excerpt unavailable for this older message.
            </p>
          )}

          {citation.context && (
            <>
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">
                Why this source was used
              </h3>
              <div className="rounded-lg bg-surface p-3 text-sm leading-relaxed text-muted">
                <span className="mb-1 block text-xs font-semibold text-ink">
                  Generated context · not a quote
                </span>
                {citation.context}
              </div>
            </>
          )}

          <a
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-canvas no-underline"
          >
            Watch on YouTube{citation.timestamp ? ` at ${citation.timestamp}` : ""} ↗
          </a>
        </div>
      </aside>
    </dialog>
  );
}

/** One assistant answer with its cited-only footer and on-demand source detail. */
export function CitedAnswer({
  text,
  citations,
  showSources = true,
}: {
  text: string;
  citations: ReadonlyMap<string, CatalogEvidence>;
  showSources?: boolean;
}) {
  const [selectedSource, setSelectedSource] =
    useState<CatalogEvidence | null>(null);
  const sources = citedSources(text, citations);

  return (
    <>
      <AnswerText
        text={text}
        citations={citations}
        onCitationClick={setSelectedSource}
      />
      {showSources && (
        <SourcesFooter sources={sources} onSourceClick={setSelectedSource} />
      )}
      {selectedSource && (
        <SourceDetail
          citation={selectedSource}
          onClose={() => setSelectedSource(null)}
        />
      )}
    </>
  );
}

/** Render stable citation IDs as compact controls while leaving ordinary prose untouched. */
export function AnswerText({
  text,
  citations,
  onCitationClick,
}: {
  text: string;
  citations: ReadonlyMap<string, CatalogEvidence>;
  onCitationClick?: (citation: CatalogEvidence) => void;
}) {
  const citationNumbers = new Map(
    citedSources(text, citations).map((citation, index) => [
      citation.citationId,
      index + 1,
    ]),
  );
  const nodes = text.split(/(\[cite:[^\]\s]+\])/g).map((piece, index) => {
    const marker = /^\[cite:([^\]\s]+)\]$/.exec(piece);
    if (!marker) return <span key={index}>{piece}</span>;

    const citation = citations.get(marker[1]!);
    if (!citation) return <span key={index}>{piece}</span>;
    const citationNumber = citationNumbers.get(citation.citationId)!;

    return (
      <button
        key={index}
        type="button"
        onClick={() => onCitationClick?.(citation)}
        className="mx-0.5 inline-grid size-5 place-items-center rounded-md border-0 bg-accent-soft p-0 align-text-top text-xs font-semibold text-accent-ink hover:opacity-80"
        aria-label={`Open source ${citationNumber}`}
        title={citation.title}
      >
        {citationNumber}
      </button>
    );
  });

  return <p className="whitespace-pre-wrap leading-relaxed">{nodes}</p>;
}
