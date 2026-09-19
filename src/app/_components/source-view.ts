import type { RouterOutputs } from "~/trpc/react";

export type ImportOverview =
  RouterOutputs["sources"]["overview"]["imports"][number];

const activeImportStatuses = [
  "queued",
  "discovering",
  "processing",
] as const;

type SourceIdentity = {
  author: string | null;
  creatorHandle: string | null;
};

/** Find the first source that can name a creator in chat suggestions. */
export function firstCreatorName(
  sources: readonly SourceIdentity[],
): string | undefined {
  for (const source of sources) {
    const name = source.author?.trim() || source.creatorHandle?.trim();
    if (name) return name;
  }
}

export function isActiveImport(status: ImportOverview["status"]): boolean {
  return activeImportStatuses.includes(
    status as (typeof activeImportStatuses)[number],
  );
}

export function importStatusLabel(job: ImportOverview): string {
  if (job.status === "completed" && job.summary.failed > 0) {
    return "Completed with failures";
  }
  return {
    queued: "Queued",
    discovering: "Discovering videos",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed",
  }[job.status];
}
