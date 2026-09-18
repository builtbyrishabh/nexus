"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { type ComponentProps, useEffect, useRef, useState } from "react";

import { MessageResponse } from "~/components/ai-elements/message";
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

/** Plain answer text for the clipboard; citation markers are UI metadata, not prose. */
export function copyableAnswerText(text: string): string {
  return text.replace(/\s*\[cite:[^\]\s]+\]/g, "");
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
}: {
  sources: CatalogEvidence[];
}) {
  if (sources.length === 0) return null;
  const groups = groupCitedSources(sources);

  return (
    <footer className="mt-5 border-t pt-3">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
        <span>Sources</span>
        <span className="font-normal text-muted-foreground">
          {groups.length} {groups.length === 1 ? "video" : "videos"} ·{" "}
          {sources.length} cited {sources.length === 1 ? "moment" : "moments"}
        </span>
      </div>
      <div className="space-y-1">
        {groups.map((group) => (
          <div
            key={group.key}
            className="grid grid-cols-1 items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <a
              href={group.citations[0]!.url}
              target="_blank"
              rel="noreferrer"
              className="group/source min-w-0 text-left no-underline"
            >
              <span className="flex items-center gap-1 text-xs font-medium text-foreground group-hover/source:underline">
                <span className="truncate">{group.title}</span>
                <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                  ↗
                </span>
              </span>
              {group.author && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {group.author} · YouTube
                </span>
              )}
            </a>
            <span className="flex flex-wrap gap-1 sm:justify-end">
              {group.citations.map((citation) => (
                <a
                  key={citation.citationId}
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-primary/10 px-1.5 py-1 text-xs font-semibold text-primary no-underline hover:bg-primary/15"
                  aria-label={`Watch ${group.title} at ${citation.timestamp ?? "source"} on YouTube`}
                >
                  {citation.timestamp ?? "Source"}
                </a>
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
        className="fixed inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-card text-card-foreground shadow-2xl sm:inset-y-0 sm:left-auto sm:w-full sm:max-w-md sm:rounded-none"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border sm:hidden" />
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cited source
            </p>
            <h2
              id={`source-${citation.citationId}`}
              className="mt-1 text-base font-semibold leading-snug text-foreground"
            >
              {citation.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="grid size-9 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-xl text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close source details"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-5 pb-6 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-4 text-sm text-muted-foreground">
            <span>{citation.author ?? "Unknown creator"}</span>
            {citation.timestamp && (
              <span className="font-semibold text-primary">
                {citation.timestamp}
              </span>
            )}
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Transcript excerpt
          </h3>
          {citation.rawText ? (
            <blockquote className="border-l-2 border-primary pl-4 text-sm leading-relaxed text-foreground">
              {citation.rawText}
            </blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">
              Transcript excerpt unavailable for this older message.
            </p>
          )}

          {citation.context && (
            <>
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Why this source was used
              </h3>
              <div className="rounded-lg bg-muted p-3 text-sm leading-relaxed text-muted-foreground">
                <span className="mb-1 block text-xs font-semibold text-foreground">
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
            className="mt-6 flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline"
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
        <SourcesFooter sources={sources} />
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
  const citationPrefix = "https://nexus.local/citation/";
  const markdown = text.replace(/\s*\[cite:([^\]\s]+)\]/g, (_marker, id: string) => {
    const citation = citations.get(id);
    const number = citation ? citationNumbers.get(citation.citationId) : undefined;
    return citation && number
      ? `[${number}](${citationPrefix}${encodeURIComponent(id)})`
      : "";
  });

  function AnswerLink({
    href,
    children,
    node: _node,
    ...props
  }: ComponentProps<"a"> & { node?: unknown }) {
    if (href?.startsWith(citationPrefix)) {
      const citationId = decodeURIComponent(href.slice(citationPrefix.length));
      const citation = citations.get(citationId);
      const citationNumber = citation
        ? citationNumbers.get(citation.citationId)
        : undefined;
      if (citation && citationNumber) {
        return (
          <button
            type="button"
            onClick={() => onCitationClick?.(citation)}
            className="mx-0.5 inline-grid size-5 place-items-center rounded-md border-0 bg-primary/10 p-0 align-text-top text-xs font-semibold text-primary hover:bg-primary/15"
            aria-label={`Open source ${citationNumber}`}
            title={citation.title}
          >
            {children}
          </button>
        );
      }
    }

    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  }

  return (
    <MessageResponse
      key={[...citationNumbers.keys()].join(":")}
      className="min-w-0 [overflow-wrap:anywhere] text-[0.975rem] leading-7 [&_[data-streamdown=table]]:max-w-full"
      components={{ a: AnswerLink }}
    >
      {markdown}
    </MessageResponse>
  );
}
