import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { source } from "~/server/db/schema";

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

/** Group owned source rows into the creator cards shown on the Sources page. */
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
    } else {
      creators.set(key, {
        handle: row.creatorHandle,
        displayName: row.creatorHandle
          ? (displayNames.get(row.creatorHandle) ?? row.creatorHandle)
          : "Other sources",
        videos: [video],
      });
    }
  }

  return [...creators.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

/** Load the searchable-library facts derived from this user's owned sources. */
export async function loadSourceLibrary(
  userId: string,
): Promise<Pick<NexusRequestContext, "hasSources" | "allowedCreators">> {
  const rows = await db
    .select({
      handle: source.creatorHandle,
      displayName: source.author,
    })
    .from(source)
    .where(eq(source.userId, userId));

  return {
    hasSources: rows.length > 0,
    allowedCreators: deriveAllowedCreators(rows),
  };
}

/** Load the current user's sources for the Sources page. */
export async function listLibraryCreators(userId: string) {
  const rows = await db
    .select({
      id: source.id,
      title: source.title,
      url: source.url,
      author: source.author,
      creatorHandle: source.creatorHandle,
    })
    .from(source)
    .where(eq(source.userId, userId))
    .orderBy(desc(source.publishedAt), desc(source.createdAt));

  return groupLibrarySources(rows);
}
