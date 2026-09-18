import { desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { source, userSource } from "~/server/db/schema";
import { listChannelImports } from "~/server/imports/channel-import";

type LibrarySourceRow = {
  id: string;
  title: string;
  url: string;
  author: string | null;
  creatorHandle: string | null;
  publishedAt: Date | null;
  addedAt: Date;
};

export type LibraryCreator = {
  handle: string | null;
  displayName: string;
  videos: Array<{
    id: string;
    title: string;
    url: string;
    publishedAt: Date | null;
    addedAt: Date;
  }>;
};

/** Group owned source rows without creating a second source-of-truth model. */
export function groupLibrarySources(
  rows: readonly LibrarySourceRow[],
): LibraryCreator[] {
  const creators = new Map<string, LibraryCreator>();

  for (const row of rows) {
    const key = row.creatorHandle ?? "";
    const existing = creators.get(key);
    const displayName = row.author?.trim() || row.creatorHandle || "Other sources";
    const video = {
      id: row.id,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      addedAt: row.addedAt,
    };

    if (existing) {
      existing.videos.push(video);
      if (displayName.length > existing.displayName.length) {
        existing.displayName = displayName;
      }
    } else {
      creators.set(key, {
        handle: row.creatorHandle,
        displayName,
        videos: [video],
      });
    }
  }

  return [...creators.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

/** Load every source through the authenticated user's memberships. */
export async function listLibraryCreators(userId: string) {
  const rows = await db
    .select({
      id: source.id,
      title: source.title,
      url: source.url,
      author: source.author,
      creatorHandle: source.creatorHandle,
      publishedAt: source.publishedAt,
      addedAt: userSource.createdAt,
    })
    .from(userSource)
    .innerJoin(source, eq(source.id, userSource.sourceId))
    .where(eq(userSource.userId, userId))
    .orderBy(desc(source.publishedAt), desc(userSource.createdAt));

  return groupLibrarySources(rows);
}

/** One bounded snapshot for the Sources page; both halves remain owner-scoped. */
export async function getSourceOverview(userId: string) {
  const [creators, imports] = await Promise.all([
    listLibraryCreators(userId),
    listChannelImports(userId),
  ]);
  return { creators, imports };
}
