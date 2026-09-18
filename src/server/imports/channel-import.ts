import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { start } from "workflow/api";

import { db } from "~/server/db";
import {
  channelImport,
  channelImportItem,
} from "~/server/db/schema";
import {
  CHANNEL_IMPORT_LIMIT,
  canRetryImport,
  importErrorMessage,
  summarizeImport,
} from "~/server/domain/channel-import";
import { discoverYoutubeChannel } from "~/server/ingest/youtube-loader";
import { runChannelImport } from "~/workflows/channel-import";

const restartableJobStatuses: Array<"queued" | "completed" | "failed"> = [
  "queued",
  "completed",
  "failed",
];
const activeJobStatuses: Array<"queued" | "discovering" | "processing"> = [
  "queued",
  "discovering",
  "processing",
];
const terminalJobStatuses: Array<"completed" | "failed"> = [
  "completed",
  "failed",
];

export class ImportNotRetryableError extends Error {}
export class ImportNotFoundError extends Error {}

/** Resolve the canonical channel identity before a user confirms paid/long-running work. */
export async function previewChannelImport(scope: string) {
  const resolved = await discoverYoutubeChannel(scope.trim(), 1);
  return {
    channelId: resolved.channelId,
    creatorHandle: resolved.creatorHandle,
    displayName: resolved.displayName ?? resolved.creatorHandle,
    importLimit: CHANNEL_IMPORT_LIMIT,
  };
}

export function combineImportHistory<T extends { createdAt: Date }>(
  active: readonly T[],
  recentTerminal: readonly T[],
): T[] {
  return [...active, ...recentTerminal].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

/** Active jobs plus recent history, with counters derived from child rows. */
export async function listChannelImports(userId: string) {
  const [active, recentTerminal] = await Promise.all([
    db.query.channelImport.findMany({
      where: and(
        eq(channelImport.userId, userId),
        inArray(channelImport.status, activeJobStatuses),
      ),
      orderBy: [desc(channelImport.createdAt)],
    }),
    db.query.channelImport.findMany({
      where: and(
        eq(channelImport.userId, userId),
        inArray(channelImport.status, terminalJobStatuses),
      ),
      orderBy: [desc(channelImport.createdAt)],
      limit: 20,
    }),
  ]);
  const jobs = combineImportHistory(active, recentTerminal);
  if (jobs.length === 0) return [];

  const itemRows = await db
    .select({
      jobId: channelImportItem.jobId,
      status: channelImportItem.status,
    })
    .from(channelImportItem)
    .where(
      inArray(
        channelImportItem.jobId,
        jobs.map((job) => job.id),
      ),
    );
  const itemsByJob = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const items = itemsByJob.get(item.jobId) ?? [];
    items.push(item);
    itemsByJob.set(item.jobId, items);
  }

  return jobs.map((job) => ({
    id: job.id,
    scope: job.scope,
    status: job.status,
    creatorHandle: job.creatorHandle,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    summary: summarizeImport(itemsByJob.get(job.id) ?? []),
  }));
}

/** Enqueue first, then persist the run ID as optional operational metadata. */
export async function launchChannelImport(jobId: string): Promise<void> {
  let run: Awaited<ReturnType<typeof start>>;
  try {
    run = await start(runChannelImport, [jobId]);
  } catch (error) {
    await db
      .update(channelImport)
      .set({
        status: "failed",
        error: importErrorMessage(error),
        finishedAt: new Date(),
      })
      .where(eq(channelImport.id, jobId));
    throw error;
  }

  try {
    await db
      .update(channelImport)
      .set({ workflowRunId: run.runId })
      .where(eq(channelImport.id, jobId));
  } catch (error) {
    // The workflow was accepted. A diagnostic write must not turn that truth into a failed job.
    console.error(
      `[channel-import] workflow ${run.runId} started for ${jobId}, but its run ID was not saved`,
      error,
    );
  }
}

/** Persist and enqueue a durable import; the workflow continues after this call returns. */
export async function startChannelImport(userId: string, scope: string) {
  const [job] = await db
    .insert(channelImport)
    .values({ userId, scope: scope.trim() })
    .returning({ id: channelImport.id });
  if (!job) throw new Error("Failed to create the channel import");

  await launchChannelImport(job.id);

  return { jobId: job.id };
}

/** Load one import through its owner predicate; foreign IDs are indistinguishable from missing. */
export async function getChannelImport(userId: string, jobId: string) {
  const job = await db.query.channelImport.findFirst({
    where: and(
      eq(channelImport.id, jobId),
      eq(channelImport.userId, userId),
    ),
  });
  if (!job) return undefined;

  const items = await db
    .select()
    .from(channelImportItem)
    .where(eq(channelImportItem.jobId, jobId))
    .orderBy(asc(channelImportItem.position));

  return {
    id: job.id,
    scope: job.scope,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    summary: summarizeImport(items),
    items: items.map((item) => ({
      id: item.id,
      videoId: item.externalId,
      position: item.position,
      status: item.status,
      attempts: item.attempts,
      sourceId: item.sourceId,
      title: item.title,
      skipReason: item.skipReason,
      error: item.error,
    })),
  };
}

/** Atomically requeue only failures, leaving successful canonical work untouched. */
export async function retryFailedChannelImport(userId: string, jobId: string) {
  const job = await db.query.channelImport.findFirst({
    where: and(
      eq(channelImport.id, jobId),
      eq(channelImport.userId, userId),
    ),
  });
  if (!job) throw new ImportNotFoundError();

  const failedItem = await db.query.channelImportItem.findFirst({
    where: and(
      eq(channelImportItem.jobId, jobId),
      eq(channelImportItem.status, "failed"),
    ),
  });
  if (!canRetryImport(job.status, failedItem ? 1 : 0)) {
    throw new ImportNotRetryableError();
  }

  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(channelImport)
      .set({ status: "queued", error: null, finishedAt: null })
      .where(
        and(
          eq(channelImport.id, jobId),
          eq(channelImport.userId, userId),
          inArray(channelImport.status, restartableJobStatuses),
        ),
      )
      .returning({ id: channelImport.id });

    if (!row) return undefined;

    await tx
      .update(channelImportItem)
      .set({ status: "queued", error: null })
      .where(
        and(
          eq(channelImportItem.jobId, jobId),
          eq(channelImportItem.status, "failed"),
        ),
      );
    return row;
  });

  if (!claimed) throw new ImportNotRetryableError();

  await launchChannelImport(jobId);

  return { jobId };
}
