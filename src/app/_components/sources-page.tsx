"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CirclePlay,
  ExternalLink,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import { api, type RouterOutputs } from "~/trpc/react";

type ImportPreview = RouterOutputs["imports"]["preview"];

const activeStatuses = new Set(["queued", "discovering", "processing"]);

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

/** User-owned source library plus the durable YouTube import workflow. */
export function SourcesPage() {
  const utils = api.useUtils();
  const [scope, setScope] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const activeJobIds = useRef(new Set<string>());

  const sources = api.imports.sources.useQuery();
  const jobs = api.imports.list.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.some((job) => activeStatuses.has(job.status))
        ? 2_500
        : false,
  });
  const selectedJob = api.imports.byId.useQuery(
    { jobId: selectedJobId ?? "00000000-0000-4000-8000-000000000000" },
    {
      enabled: Boolean(selectedJobId),
      refetchInterval: (query) =>
        query.state.data && activeStatuses.has(query.state.data.status)
          ? 2_500
          : false,
    },
  );

  const startImport = api.imports.start.useMutation({
    onSuccess: ({ jobId }) => {
      setSelectedJobId(jobId);
      setPreview(null);
      setScope("");
      void utils.imports.list.invalidate();
    },
  });
  const retryImport = api.imports.retryFailures.useMutation({
    onSuccess: ({ jobId }) => {
      void utils.imports.byId.invalidate({ jobId });
      void utils.imports.list.invalidate();
    },
  });
  const removeSource = api.imports.removeSource.useMutation({
    onSuccess: () => {
      void utils.imports.sources.invalidate();
    },
  });

  useEffect(() => {
    if (!jobs.data) return;
    const nextActiveIds = new Set(
      jobs.data
        .filter((job) => activeStatuses.has(job.status))
        .map((job) => job.id),
    );
    const importFinished = [...activeJobIds.current].some(
      (jobId) => !nextActiveIds.has(jobId),
    );
    activeJobIds.current = nextActiveIds;
    if (importFinished) void utils.imports.sources.invalidate();
  }, [jobs.data, utils.imports.sources]);

  async function resolveScope() {
    const value = scope.trim();
    if (!value) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(await utils.imports.preview.fetch({ scope: value }));
    } catch (error) {
      setPreview(null);
      setPreviewError(
        error instanceof Error ? error.message : "Could not resolve that YouTube source.",
      );
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Add YouTube creators to your library, follow import progress, and manage
            what Nexus can use in answers.
          </p>
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Plus className="size-5" />
            </div>
            <div>
              <h2 className="font-semibold">Add a YouTube source</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste a channel URL, @handle, channel ID, or a video from the channel.
              </p>
            </div>
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void resolveScope();
            }}
          >
            <Input
              value={scope}
              onChange={(event) => {
                setScope(event.currentTarget.value);
                setPreview(null);
                setPreviewError(null);
              }}
              placeholder="https://youtube.com/@creator"
              aria-label="YouTube channel, handle, or video"
              className="h-10 flex-1"
            />
            <Button type="submit" disabled={!scope.trim() || previewing} className="h-10">
              {previewing ? <Loader2 className="animate-spin" /> : <CirclePlay />}
              Preview source
            </Button>
          </form>

          {previewError && (
            <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {previewError}
            </p>
          )}

          {preview && (
            <div className="mt-4 flex flex-col gap-4 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{preview.displayName}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  @{preview.creatorHandle} · latest {preview.importLimit} uploads
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => startImport.mutate({ scope: scope.trim() })}
                  disabled={startImport.isPending}
                >
                  {startImport.isPending && <Loader2 className="animate-spin" />}
                  Start import
                </Button>
              </div>
            </div>
          )}

          {startImport.error && (
            <p className="mt-3 text-sm text-destructive">
              {startImport.error.message}
            </p>
          )}
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <section>
            <button
              type="button"
              aria-expanded={libraryOpen}
              aria-controls="source-library"
              onClick={() => setLibraryOpen((open) => !open)}
              className="mb-3 flex w-full items-center gap-2 rounded-lg text-left"
            >
              <h2 className="text-lg font-semibold">Your library</h2>
              {sources.data && (
                <span className="ml-auto text-sm text-muted-foreground">
                  {sources.data.length} {sources.data.length === 1 ? "video" : "videos"}
                </span>
              )}
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${libraryOpen ? "rotate-180" : ""}`}
              />
            </button>

            {libraryOpen && (
              <div id="source-library">
                {removeSource.error && (
                  <p className="mb-3 text-sm text-destructive">
                    {removeSource.error.message}
                  </p>
                )}

                {sources.isLoading ? (
                  <div className="h-36 animate-pulse rounded-2xl bg-muted" />
                ) : sources.error ? (
                  <QueryError
                    message="Nexus could not load your source library."
                    onRetry={() => void sources.refetch()}
                  />
                ) : sources.data?.length ? (
                  <div className="overflow-hidden rounded-2xl border bg-card">
                    {sources.data.map((source, index) => (
                      <div
                        key={source.id}
                        className={`flex items-center gap-3 p-4 ${index ? "border-t" : ""}`}
                      >
                        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
                          <CirclePlay className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{source.title}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {source.author ?? source.creatorHandle ?? "YouTube"}
                          </p>
                        </div>
                        <Button asChild variant="ghost" size="icon-sm">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${source.title}`}
                          >
                            <ExternalLink />
                          </a>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${source.title}`}
                            >
                              <Trash2 />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this source?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Nexus will stop using “{source.title}” in future answers.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep source</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  removeSource.mutate({ sourceId: source.id })
                                }
                              >
                                Remove source
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed p-8 text-center">
                    <Library className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 font-medium">Add your first source</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      Import a creator above, then ask questions across their latest videos.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Recent imports</h2>
            {jobs.isLoading ? (
              <div className="h-36 animate-pulse rounded-2xl bg-muted" />
            ) : jobs.error ? (
              <QueryError
                message="Nexus could not load your recent imports."
                onRetry={() => void jobs.refetch()}
              />
            ) : jobs.data?.length ? (
              <div className="space-y-3">
                {jobs.data.map((job) => {
                  const finished =
                    job.summary.ingested + job.summary.skipped + job.summary.failed;
                  const progress = job.summary.discovered
                    ? (finished / job.summary.discovered) * 100
                    : job.status === "queued"
                      ? 4
                      : 12;
                  const active = activeStatuses.has(job.status);

                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedJobId(job.id)}
                      className="w-full rounded-2xl border bg-card p-4 text-left transition hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">
                          {job.creatorHandle ? `@${job.creatorHandle}` : job.scope}
                        </p>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {active ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : job.status === "completed" ? (
                            <CheckCircle2 className="size-3 text-emerald-500" />
                          ) : (
                            <AlertCircle className="size-3 text-destructive" />
                          )}
                          {statusLabel(job.status)}
                        </span>
                      </div>
                      <Progress value={progress} className="mt-3" />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {job.summary.ingested} indexed · {job.summary.processing} processing ·{" "}
                        {job.summary.failed} failed
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                Your imports will appear here and continue even if you leave this page.
              </div>
            )}
          </section>
        </div>

        {selectedJobId && selectedJob.data && (
          <section className="mt-8 rounded-2xl border bg-card p-5 md:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Import details
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {selectedJob.data.scope}
                </h2>
              </div>
              {(selectedJob.data.status === "failed" ||
                (selectedJob.data.status === "completed" &&
                  selectedJob.data.summary.failed > 0)) && (
                <Button
                  variant="outline"
                  onClick={() => retryImport.mutate({ jobId: selectedJobId })}
                  disabled={retryImport.isPending}
                >
                  <RefreshCw className={retryImport.isPending ? "animate-spin" : ""} />
                  Retry failed videos
                </Button>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(selectedJob.data.summary).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {selectedJob.data.error && (
              <p className="mt-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive">
                {selectedJob.data.error}
              </p>
            )}

            {retryImport.error && (
              <p className="mt-3 text-sm text-destructive">
                {retryImport.error.message}
              </p>
            )}

            {selectedJob.data.items.some((item) => item.status === "failed") && (
              <div className="mt-5 space-y-2">
                <h3 className="text-sm font-semibold">Needs attention</h3>
                {selectedJob.data.items
                  .filter((item) => item.status === "failed")
                  .map((item) => (
                    <div key={item.id} className="rounded-xl border p-3 text-sm">
                      <p className="font-medium">{item.title ?? item.videoId}</p>
                      <p className="mt-1 text-xs text-destructive">
                        {item.error ?? "This video could not be imported."}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}

        {selectedJobId && selectedJob.error && (
          <section className="mt-8 rounded-2xl border bg-card p-5 md:p-6">
            <QueryError
              message="Nexus could not load this import's details."
              onRetry={() => void selectedJob.refetch()}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function QueryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5">
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="size-4" /> {message}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw /> Try again
      </Button>
    </div>
  );
}
