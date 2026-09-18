import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { source, userSource } from "~/server/db/schema";

export const allowedCreatorSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1),
});

export type AllowedCreator = z.infer<typeof allowedCreatorSchema>;

export const nexusRequestContextSchema = z.object({
  userId: z.string().min(1),
  hasSources: z.boolean(),
  allowedCreators: z.array(allowedCreatorSchema),
});

export type NexusRequestContext = z.infer<typeof nexusRequestContextSchema>;

/** Give one user access to a canonical source without duplicating its content. */
export async function attachSourceToUser(userId: string, sourceId: string) {
  await db
    .insert(userSource)
    .values({ userId, sourceId })
    .onConflictDoNothing();
}

/** The user-facing source library, ordered for a recent-first management view. */
export async function listOwnedSources(userId: string) {
  return db
    .select({
      id: source.id,
      title: source.title,
      url: source.url,
      author: source.author,
      creatorHandle: source.creatorHandle,
      publishedAt: source.publishedAt,
      createdAt: source.createdAt,
    })
    .from(source)
    .leftJoin(
      userSource,
      and(eq(source.id, userSource.sourceId), eq(userSource.userId, userId)),
    )
    .where(or(eq(userSource.userId, userId), eq(source.userId, userId)))
    .orderBy(desc(source.createdAt));
}

/** Remove only this user's membership; canonical content and other memberships remain. */
export async function removeOwnedSource(
  userId: string,
  sourceId: string,
): Promise<boolean> {
  const removedMemberships = await db
    .delete(userSource)
    .where(
      and(eq(userSource.sourceId, sourceId), eq(userSource.userId, userId)),
    )
    .returning({ sourceId: userSource.sourceId });
  const removedLegacyOwnership = await db
    .update(source)
    .set({ userId: null })
    .where(and(eq(source.id, sourceId), eq(source.userId, userId)))
    .returning({ sourceId: source.id });

  return removedMemberships.length > 0 || removedLegacyOwnership.length > 0;
}

type CreatorSource = {
  handle: string | null;
  displayName: string | null;
};

type LibrarySourceRow = {
  id: string;
  title: string;
  url: string;
  author: string | null;
  creatorHandle: string | null;
};

type LibraryCreator = {
  handle: string | null;
  displayName: string;
  videos: Array<Pick<LibrarySourceRow, "id" | "title" | "url">>;
};

/** Collapse a user's sources into a stable, unique creator roster. */
export function deriveAllowedCreators(rows: CreatorSource[]): AllowedCreator[] {
  const creators = new Map<string, Set<string>>();

  for (const row of rows) {
    const handle = row.handle;
    if (!handle?.trim()) continue;

    const displayName = row.displayName?.trim();
    const names = creators.get(handle) ?? new Set<string>();
    if (displayName) names.add(displayName);
    creators.set(handle, names);
  }

  return [...creators]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([handle, names]) => ({
      handle,
      displayName:
        [...names].sort(
          (left, right) =>
            right.length - left.length || left.localeCompare(right),
        )[0] ?? handle,
    }));
}

/** Group owned source rows into the creator cards used by the earlier Sources API. */
export function groupLibrarySources(
  rows: readonly LibrarySourceRow[],
): LibraryCreator[] {
  const displayNames = new Map(
    deriveAllowedCreators(
      rows.map((row) => ({
        handle: row.creatorHandle,
        displayName: row.author,
      })),
    ).map((creator) => [creator.handle, creator.displayName]),
  );
  const creators = new Map<string, LibraryCreator>();

  for (const row of rows) {
    const key = row.creatorHandle ?? "";
    const video = { id: row.id, title: row.title, url: row.url };
    const existing = creators.get(key);
    if (existing) {
      existing.videos.push(video);
      continue;
    }

    creators.set(key, {
      handle: row.creatorHandle,
      displayName: row.creatorHandle
        ? (displayNames.get(row.creatorHandle) ?? row.creatorHandle)
        : "Other sources",
      videos: [video],
    });
  }

  return [...creators.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

/** Compatibility read for the existing source overview endpoint. */
export async function listLibraryCreators(userId: string) {
  return groupLibrarySources(await listOwnedSources(userId));
}

/** Load the searchable-library facts derived from this user's source memberships. */
export async function loadSourceLibrary(
  userId: string,
): Promise<Pick<NexusRequestContext, "hasSources" | "allowedCreators">> {
  const rows = await db
    .select({
      handle: source.creatorHandle,
      displayName: source.author,
    })
    .from(source)
    .leftJoin(
      userSource,
      and(eq(source.id, userSource.sourceId), eq(userSource.userId, userId)),
    )
    .where(or(eq(userSource.userId, userId), eq(source.userId, userId)));

  return {
    hasSources: rows.length > 0,
    allowedCreators: deriveAllowedCreators(rows),
  };
}
