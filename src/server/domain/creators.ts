/**
 * The creator roster — the one source of truth for who can be scoped, how their name is shown,
 * and who appears on the panel. Deliberately a code constant, not a `creator` table: Slice 4 only
 * needs a stable slug on `source` plus a display name, and the panel lineup is a product decision
 * we make here. When the community bot (#14) needs per-tenant config/tokens, this promotes to a
 * table then — cheaper to change later than to carry an unused table now (ETC).
 *
 * `handle` is the slug stored in `source.creator_handle` and used as the retrieval scope key.
 * `displayName` is what the UI labels a column with and what the neutral refusal names. We never
 * infer a pronoun from a name — the refusal says "their" (see `refusalText`).
 */
export type Creator = {
  handle: string;
  displayName: string;
};

export const CREATORS: Creator[] = [
  { handle: "hormozi", displayName: "Alex Hormozi" },
  { handle: "naval", displayName: "Naval Ravikant" },
  { handle: "codie", displayName: "Codie Sanchez" },
];

/** The creators shown side by side on `/panel`, in order. Same list for now; its own name so the
 * lineup can diverge from the roster (e.g. an archived creator) without touching scope logic. */
export const PANEL_LINEUP: readonly string[] = CREATORS.map((c) => c.handle);

const BY_HANDLE = new Map(CREATORS.map((c) => [c.handle, c]));

export function creatorByHandle(handle: string): Creator | undefined {
  return BY_HANDLE.get(handle);
}

/** Display name for a handle, or undefined when unscoped (home chat / eval run across no creator). */
export function displayNameFor(handle?: string): string | undefined {
  return handle ? BY_HANDLE.get(handle)?.displayName : undefined;
}
