import type {
  ChannelImport,
  ChannelImportItem,
} from "~/server/db/schema";

export const CHANNEL_IMPORT_LIMIT = 50;

export type ImportJobStatus = ChannelImport["status"];
export type ImportItemStatus = ChannelImportItem["status"];

export type ImportSummary = {
  discovered: number;
  queued: number;
  processing: number;
  ingested: number;
  skipped: number;
  failed: number;
};

/** Derive progress from the child rows so counters cannot drift during retries or crashes. */
export function summarizeImport(
  items: ReadonlyArray<Pick<ChannelImportItem, "status">>,
): ImportSummary {
  const summary: ImportSummary = {
    discovered: items.length,
    queued: 0,
    processing: 0,
    ingested: 0,
    skipped: 0,
    failed: 0,
  };

  for (const item of items) summary[item.status]++;
  return summary;
}

/** Only terminal jobs can restart; completed jobs need at least one failed video. */
export function canRetryImport(
  status: ImportJobStatus,
  failedItems: number,
): boolean {
  return status === "failed" || (status === "completed" && failedItems > 0);
}

/** Persist a bounded, user-safe error string instead of provider objects or stack traces. */
export function importErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.trim() || "Unknown import error").slice(0, 1_000);
}
