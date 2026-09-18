"use client";

import { useState } from "react";

import { importStatusLabel, isActiveImport } from "~/app/_components/source-view";
import { api, type RouterOutputs } from "~/trpc/react";

export default function SourcesPage() {
  const utils = api.useUtils();
  const [scope, setScope] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const overview = api.sources.overview.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.imports.some((job) => isActiveImport(job.status))
        ? 2_500
        : false,
  });
  const job = api.imports.byId.useQuery(
    { jobId: selectedJobId ?? "" },
    {
      enabled: Boolean(selectedJobId),
      refetchInterval: (query) =>
        query.state.data && isActiveImport(query.state.data.status)
          ? 2_500
          : false,
    },
  );

  const startMutation = api.imports.start.useMutation({
    async onSuccess(result) {
      setSelectedJobId(result.jobId);
      setScope("");
      await utils.sources.overview.invalidate();
    },
  });
  const retryMutation = api.imports.retryFailures.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sources.overview.invalidate(),
        selectedJobId
          ? utils.imports.byId.invalidate({ jobId: selectedJobId })
          : Promise.resolve(),
      ]);
    },
  });
  function submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startMutation.mutate({ scope });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold text-ink">Sources</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Add YouTube creators and see exactly which videos Nexus can use in
            answers.
          </p>
        </header>

        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <h2 className="font-semibold text-ink">Add a source</h2>
          <p className="mt-1 text-sm text-muted">
            Paste a video URL, channel URL, @handle, or channel ID to import
            the latest 50 uploads.
          </p>
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row"
            onSubmit={submitImport}
          >
            <input
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="https://youtube.com/@creator"
              aria-label="YouTube source"
              className="min-w-0 flex-1 rounded-xl border border-line bg-elevated px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent"
            />
            <button
              type="submit"
              disabled={!scope.trim() || startMutation.isPending}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startMutation.isPending ? "Starting…" : "Import latest 50"}
            </button>
          </form>

          {startMutation.error ? (
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
              {startMutation.error.message}
            </p>
          ) : null}
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Recent imports</h2>
            {overview.isFetching && !overview.isLoading ? (
              <span className="text-xs text-muted">Updating…</span>
            ) : null}
          </div>
          {overview.isLoading ? (
            <LoadingCards />
          ) : overview.error ? (
            <EmptyState text="We could not load recent imports." />
          ) : overview.data?.imports.length ? (
            <div className="space-y-3">
              {overview.data.imports.map((entry) => {
                const selected = selectedJobId === entry.id;
                return (
                  <article
                    key={entry.id}
                    className="rounded-xl border border-line bg-elevated p-4"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedJobId(selected ? null : entry.id)}
                      className="flex w-full items-start justify-between gap-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">
                          {entry.creatorHandle
                            ? `@${entry.creatorHandle}`
                            : entry.scope}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {entry.summary.discovered > 0
                            ? `${entry.summary.ingested} / ${entry.summary.discovered} indexed`
                            : "Preparing import"}
                          {` · ${entry.summary.processing} processing · ${entry.summary.skipped} skipped · ${entry.summary.failed} failed`}
                        </p>
                      </div>
                      <StatusBadge status={importStatusLabel(entry)} />
                    </button>
                    {selected ? (
                      <ImportDetails
                        job={job.data}
                        loading={job.isLoading}
                        error={job.error?.message}
                        retrying={retryMutation.isPending}
                        retryError={retryMutation.error?.message}
                        onRetry={() => retryMutation.mutate({ jobId: entry.id })}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState text="No imports yet. Add a creator above to begin." />
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-ink">Your library</h2>
          {overview.isLoading ? (
            <LoadingCards />
          ) : overview.error ? (
            <EmptyState text="We could not load your source library." />
          ) : overview.data?.creators.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {overview.data.creators.map((creator) => (
                <article
                  key={creator.handle ?? "other-sources"}
                  className="rounded-xl border border-line bg-elevated p-4"
                >
                  <div>
                    <h3 className="font-medium text-ink">{creator.displayName}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {creator.handle ? `@${creator.handle} · ` : ""}
                      {creator.videos.length} indexed video
                      {creator.videos.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <ul className="mt-3 divide-y divide-line">
                    {creator.videos.map((video) => (
                      <li key={video.id} className="py-2.5 first:pt-0 last:pb-0">
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noreferrer"
                          className="line-clamp-2 text-sm text-ink hover:text-accent-ink"
                        >
                          {video.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState text="Your library is empty. Imported videos will appear here as soon as they are ready." />
          )}
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink">
      {status}
    </span>
  );
}

type ImportDetailsData = RouterOutputs["imports"]["byId"];

function ImportDetails({
  job,
  loading,
  error,
  retrying,
  retryError,
  onRetry,
}: {
  job: ImportDetailsData | undefined;
  loading: boolean;
  error?: string;
  retrying: boolean;
  retryError?: string;
  onRetry: () => void;
}) {
  if (loading) return <p className="mt-4 text-sm text-muted">Loading videos…</p>;
  if (error) {
    return (
      <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }
  if (!job) return null;

  const failures = job.items.filter((item) => item.status === "failed");
  const canRetry =
    !isActiveImport(job.status) &&
    (job.status === "failed" || failures.length > 0);
  return (
    <div className="mt-4 border-t border-line pt-4">
      {retryError ? (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {retryError}
        </p>
      ) : null}
      {job.error ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{job.error}</p>
      ) : null}
      {failures.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">
              {failures.length} failed video{failures.length === 1 ? "" : "s"}
            </p>
            {canRetry ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "Retry failures"}
              </button>
            ) : null}
          </div>
          <ul className="mt-2 space-y-2">
            {failures.map((item) => (
              <li key={item.id} className="rounded-lg bg-surface p-3 text-sm">
                <p className="font-medium text-ink">
                  {item.title ?? item.videoId}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {item.error ?? "Import failed"}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {isActiveImport(job.status)
              ? "Videos become searchable as each one finishes."
              : job.status === "failed"
                ? "The import stopped before videos were discovered."
                : "No failed videos."}
          </p>
          {canRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry import"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      {text}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-3" aria-label="Loading">
      <div className="h-20 animate-pulse rounded-xl bg-surface" />
      <div className="h-20 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}
