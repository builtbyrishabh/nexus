import "./_env";

import { isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { source as sourceTable } from "~/server/db/schema";

/**
 * One-shot backfill for the Panel creator seam (Slice 4): tag every existing, untagged source
 * with a creator handle. The whole current corpus is one creator (Hormozi, 31 uploads), so this
 * is a single UPDATE of the NULL rows — idempotent (already-tagged rows are left alone) and safe
 * to re-run. Run once after `pnpm db:push` adds the `creator_handle` column.
 *
 * The handle you pass IS the creator — the roster is derived from tagged sources, so any handle is
 * valid and tagging is what puts a creator on the roster.
 *
 *   pnpm tsx scripts/backfill-creator.ts            # defaults to "hormozi"
 *   pnpm tsx scripts/backfill-creator.ts <handle>
 */
async function main() {
  const handle = process.argv[2] ?? "hormozi";

  const updated = await db
    .update(sourceTable)
    .set({ creatorHandle: handle })
    .where(isNull(sourceTable.creatorHandle))
    .returning({ id: sourceTable.id });

  console.log(`✓ tagged ${updated.length} untagged source(s) as "${handle}"`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
