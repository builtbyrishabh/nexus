import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { start } from "workflow/api";

import { db } from "~/server/db";
import {
  channelImport,
  channelImportItem,
} from "~/server/db/schema";
import {
  canRetryImport,
  importErrorMessage,
  summarizeImport,
} from "~/server/domain/channel-import";
import { resolveYoutubeChannel } from "~/server/ingest/youtube-loader";
import { runChannelImport } from "~/workflows/channel-import";

const terminalJobStatuses: Array<"completed" | "failed"> = [
  "completed",
  "failed",
];

export class ImportNotRetryableError extends Error {}
export class ImportNotFoundError extends Error {}

/** Persist and enqueue a durable import; the workflow continues after this call returns. */
export async function startChannelImport(userId: string, scope: string) {
  const resolved = await resolveYoutubeChannel(scope);
  const [job] = await db
    .insert(channelImport)
    .values({
      userId,
      scope: resolved.channelId,
      creatorHandle: resolved.creatorHandle,
    })
    .returning({ id: channelImport.id });
  if (!job) throw new Error("Failed to create the channel import");

  try {
    const run = await start(runChannelImport, [job.id]);
    await db
      .update(channelImport)
      .set({ workflowRunId: run.runId })
      .where(eq(channelImport.id, job.id));
  } catch (error) {
    await db
      .update(channelImport)
      .set({
        status: "failed",
        error: importErrorMessage(error),
        finishedAt: new Date(),
      })
      .where(eq(channelImport.id, job.id));
    throw error;
  }

  return { jobId: job.id };
}

/** Recent owned imports for the Sources overview; item counts remain derived. */
export async function listChannelImports(userId: string) {
  const jobs = await db
    .select()
    .from(channelImport)
    .where(eq(channelImport.userId, userId))
    .orderBy(desc(channelImport.createdAt))
    .limit(20);

  if (jobs.length === 0) return [];

  const items = await db
    .select({ jobId: channelImportItem.jobId, status: channelImportItem.status })
    .from(channelImportItem)
    .where(inArray(channelImportItem.jobId, jobs.map((job) => job.id)));
  const itemsByJob = new Map<string, typeof items>();
  for (const item of items) {
    const jobItems = itemsByJob.get(item.jobId) ?? [];
    jobItems.push(item);
    itemsByJob.set(item.jobId, jobItems);
  }

  return jobs.map((job) => ({
    id: job.id,
    scope: job.scope,
    creatorHandle: job.creatorHandle,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    summary: summarizeImport(itemsByJob.get(job.id) ?? []),
  }));
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
          inArray(channelImport.status, terminalJobStatuses),
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

  try {
    const run = await start(runChannelImport, [jobId]);
    await db
      .update(channelImport)
      .set({ workflowRunId: run.runId })
      .where(eq(channelImport.id, jobId));
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

  return { jobId };
}
