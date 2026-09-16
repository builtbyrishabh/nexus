/**
 * Creator display metadata — the *cosmetic* half of the roster, and the only half that lives in code.
 *
 * WHO exists and can be searched is no longer declared here: it's derived from what's actually been
 * ingested (`distinct source.creator_handle`) by `~/server/domain/roster`. That makes ingestion the
 * single source of truth — ingest a new creator and they become searchable with zero code change.
 *
 * This file only prettifies a handle into a name. Resolution order is override → channel author →
 * the raw handle, so a newly ingested creator is already nameable (from its channel author); an
 * override is a purely optional polish. We never infer a pronoun from a name (see `refusalText`).
 */
export type Creator = {
  handle: string;
  displayName: string;
};

/**
 * Optional curated names. Everything not listed here falls back to the channel author, then the raw
 * handle — so this map is convenience, never a gate on who can be searched.
 */
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  hormozi: "Alex Hormozi",
  naval: "Naval Ravikant",
  codie: "Codie Sanchez",
};

/** Display name for a handle: curated override → channel author → the raw handle. */
export function displayNameFor(handle?: string, author?: string | null): string | undefined {
  if (!handle) return undefined;
  return DISPLAY_NAME_OVERRIDES[handle] ?? author ?? handle;
}
