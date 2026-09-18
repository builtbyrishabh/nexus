import type { RouterOutputs } from "~/trpc/react";

export type ImportOverview =
  RouterOutputs["sources"]["overview"]["imports"][number];

const activeImportStatuses = [
  "queued",
  "discovering",
  "processing",
] as const;

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
