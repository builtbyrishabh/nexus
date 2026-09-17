import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "~/server/db";
import { channelImport, source, userSource } from "~/server/db/schema";
import { CHANNEL_IMPORT_LIMIT } from "~/server/domain/channel-import";
import { listChannelImports } from "~/server/imports/channel-import";
import { resolveYoutubeChannel } from "~/server/ingest/youtube-loader";

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

export class SourceRemovalConflictError extends Error {}

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

export async function previewYoutubeSource(scope: string) {
  const resolved = await resolveYoutubeChannel(scope);
  return {
    ...resolved,
    displayName: resolved.displayName ?? `@${resolved.creatorHandle}`,
    importLimit: CHANNEL_IMPORT_LIMIT,
  };
}

/** One bounded snapshot for the Sources page; both halves remain owner-scoped. */
export async function getSourceOverview(userId: string) {
  const [creators, imports] = await Promise.all([
    listLibraryCreators(userId),
    listChannelImports(userId),
  ]);
  return { creators, imports };
}

/** Remove memberships only. Canonical transcripts and embeddings remain shared. */
export async function removeLibraryCreator(
  userId: string,
  creatorHandle: string,
) {
  return db.transaction(async (tx) => {
    const activeImport = await tx.query.channelImport.findFirst({
      where: and(
        eq(channelImport.userId, userId),
        eq(channelImport.creatorHandle, creatorHandle),
        inArray(channelImport.status, ["queued", "discovering", "processing"]),
      ),
    });
    if (activeImport) {
      throw new SourceRemovalConflictError(
        "Wait for the active import to finish before removing this creator.",
      );
    }

    const memberships = await tx
      .select({ sourceId: userSource.sourceId })
      .from(userSource)
      .innerJoin(source, eq(source.id, userSource.sourceId))
      .where(
        and(
          eq(userSource.userId, userId),
          eq(source.creatorHandle, creatorHandle),
        ),
      );
    if (memberships.length === 0) return { removed: 0 };

    const removed = await tx
      .delete(userSource)
      .where(
        and(
          eq(userSource.userId, userId),
          inArray(
            userSource.sourceId,
            memberships.map((membership) => membership.sourceId),
          ),
        ),
      )
      .returning({ sourceId: userSource.sourceId });

    return { removed: removed.length };
  });
}
