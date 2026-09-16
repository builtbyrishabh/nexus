import "server-only";
import { sql } from "drizzle-orm";

import { db } from "~/server/db";
import { source } from "~/server/db/schema";
import { displayNameFor, type Creator } from "~/server/domain/creators";

/**
 * The creator roster, derived from what's actually been ingested — the one source of truth for who
 * can be searched and shown. One entry per distinct `source.creator_handle`, ordered by first
 * ingested (a stable lineup), with the display name resolved (override → channel author → handle).
 * Ingest a new creator and they appear here automatically; no code edit makes them searchable.
 */
export async function listCreators(): Promise<Creator[]> {
  const rows = (await db.execute(sql`
    SELECT
      s.creator_handle AS handle,
      (ARRAY_AGG(s.author ORDER BY s.created_at))[1] AS author
    FROM ${source} s
    WHERE s.creator_handle IS NOT NULL
    GROUP BY s.creator_handle
    ORDER BY MIN(s.created_at) ASC
  `)) as unknown as { handle: string; author: string | null }[];

  return rows.map((r) => ({
    handle: r.handle,
    displayName: displayNameFor(r.handle, r.author) ?? r.handle,
  }));
}

/** handle → display name, so the streaming path can name a refusal without a second DB lookup. */
export function creatorNameMap(creators: Creator[]): Record<string, string> {
  return Object.fromEntries(creators.map((c) => [c.handle, c.displayName]));
}
