import pMap from "p-map";

import { env } from "~/env";
import type { ChannelScope, SourceLoader, SourceRef } from "~/server/domain/types";
import type { IngestResult } from "~/server/ingest/pipeline";

/** Videos in flight at once. A constant, not a knob: enough to overlap network waits. */
export const IN_FLIGHT = 3;

type Ingest = (ref: SourceRef, loader: SourceLoader) => Promise<IngestResult>;

/**
 * Fan `discover()` out over `ingestSource()` with per-video isolation: one video's failure
 * is recorded, never fatal to the run. Outcomes come back in discovery order regardless of
 * completion order. No retries — the gates make re-running the retry.
 */
export async function ingestChannel(
  scope: ChannelScope,
  opts: { limit?: number; loader: SourceLoader; ingest: Ingest },
): Promise<IngestResult[]> {
  const { limit, loader, ingest } = opts;
  return pMap(
    loader.discover(scope, { limit }),
    async (ref): Promise<IngestResult> => {
      try {
        return await ingest(ref, loader);
      } catch (error) {
        return { status: "failed", ref, error };
      }
    },
    { concurrency: env.SUPADATA_API_KEY ? 1 : IN_FLIGHT },
  );
}

export type RunSummary = {
  ingested: number;
  skipped: number;
  failed: number;
  /** Exit-code contract: false if any video failed or the run was empty. */
  ok: boolean;
};

export function summarize(outcomes: IngestResult[]): RunSummary {
  const count = (status: IngestResult["status"]) =>
    outcomes.filter((o) => o.status === status).length;
  const failed = count("failed");
  return {
    ingested: count("ingested"),
    skipped: count("skipped"),
    failed,
    ok: failed === 0 && outcomes.length > 0,
  };
}
