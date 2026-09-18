import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { FatalError } from "workflow";

import { db } from "~/server/db";
import {
  channelImport,
  channelImportItem,
  source,
} from "~/server/db/schema";
import { importErrorMessage } from "~/server/domain/channel-import";
import type { SourceRef } from "~/server/domain/types";
import { IN_FLIGHT } from "~/server/ingest/channel";
import { ingestSource } from "~/server/ingest/pipeline";
import {
  discoverYoutubeChannel,
  youtubeLoader,
} from "~/server/ingest/youtube-loader";

type ImportWorkItem = { id: string; externalId: string };
const DISCOVERY_LIMIT = 50;

type ImportItemSteps = {
  process(item: ImportWorkItem): Promise<void>;
  fail(itemId: string, error: string): Promise<void>;
};

/** Bounded, failure-isolated orchestration kept injectable for deterministic tests. */
export async function settleImportItems(
  items: ImportWorkItem[],
  steps: ImportItemSteps,
): Promise<void> {
  for (let index = 0; index < items.length; index += IN_FLIGHT) {
    await Promise.all(
      items.slice(index, index + IN_FLIGHT).map(async (item) => {
        try {
          await steps.process(item);
        } catch (error) {
          await steps.fail(item.id, importErrorMessage(error));
        }
      }),
    );
  }
}

/** Durable orchestration: discover once, then settle videos in groups of three. */
export async function runChannelImport(jobId: string): Promise<void> {
  "use workflow";

  try {
    const items = await prepareImport(jobId);
    await settleImportItems(items, {
      process: processImportVideo,
      fail: failImportVideo,
    });
    await completeImport(jobId);
  } catch (error) {
    await failImport(jobId, importErrorMessage(error));
    throw error;
  }
}

async function prepareImport(jobId: string): Promise<ImportWorkItem[]> {
  "use step";

  const job = await db.query.channelImport.findFirst({
    where: eq(channelImport.id, jobId),
  });
  if (!job) throw new FatalError(`Import job ${jobId} does not exist`);

  const queued = await db
    .select({ id: channelImportItem.id, externalId: channelImportItem.externalId })
    .from(channelImportItem)
    .where(
      and(
        eq(channelImportItem.jobId, jobId),
        eq(channelImportItem.status, "queued"),
      ),
    )
    .orderBy(asc(channelImportItem.position));

  if (queued.length > 0) {
    await db
      .update(channelImport)
      .set({ status: "processing", startedAt: job.startedAt ?? new Date() })
      .where(eq(channelImport.id, jobId));
    return queued;
  }

  const existingItems = await db.query.channelImportItem.findFirst({
    where: eq(channelImportItem.jobId, jobId),
  });
  if (existingItems) return [];

  await db
    .update(channelImport)
    .set({ status: "discovering", startedAt: job.startedAt ?? new Date() })
    .where(eq(channelImport.id, jobId));

  const discovered = await discoverYoutubeChannel(
    job.scope,
    DISCOVERY_LIMIT,
  );
  if (discovered.refs.length === 0) {
    throw new FatalError("The channel has no discoverable videos");
  }

  return db.transaction(async (tx) => {
    const items = await tx
      .insert(channelImportItem)
      .values(
        discovered.refs.map((ref, position) => ({
          jobId,
          externalId: ref.externalId,
          position,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: channelImportItem.id, externalId: channelImportItem.externalId });

    await tx
      .update(channelImport)
      .set({
        creatorHandle: discovered.creatorHandle,
        status: "processing",
      })
      .where(eq(channelImport.id, jobId));

    return items;
  });
}

async function processImportVideo(item: ImportWorkItem): Promise<void> {
  "use step";

  const [claimed] = await db
    .update(channelImportItem)
    .set({
      status: "processing",
      attempts: sql`${channelImportItem.attempts} + 1`,
      error: null,
    })
    .where(
      and(
        eq(channelImportItem.id, item.id),
        eq(channelImportItem.status, "queued"),
      ),
    )
    .returning({ jobId: channelImportItem.jobId });

  if (!claimed) return;

  const job = await db.query.channelImport.findFirst({
    where: eq(channelImport.id, claimed.jobId),
  });
  if (!job) throw new FatalError(`Import job ${claimed.jobId} does not exist`);

  const ref: SourceRef = {
    kind: "youtube_video",
    externalId: item.externalId,
  };

  try {
    const outcome = await ingestSource(ref, youtubeLoader, {
      ...(job.creatorHandle ? { creatorHandle: job.creatorHandle } : {}),
    });

    await db.transaction(async (tx) => {
      await tx
        .update(source)
        .set({
          userId: job.userId,
          ...(job.creatorHandle ? { creatorHandle: job.creatorHandle } : {}),
        })
        .where(eq(source.id, outcome.sourceId));

      await tx
        .update(channelImportItem)
        .set({
          status: outcome.status,
          sourceId: outcome.sourceId,
          title: outcome.title,
          skipReason: outcome.status === "skipped" ? outcome.reason : null,
          error: null,
        })
        .where(eq(channelImportItem.id, item.id));
    });
  } catch (error) {
    await db
      .update(channelImportItem)
      .set({ status: "failed", error: importErrorMessage(error) })
      .where(eq(channelImportItem.id, item.id));
  }
}

// A workflow replay must never multiply an ambiguous paid-transcription attempt.
(processImportVideo as typeof processImportVideo & { maxRetries: number }).maxRetries = 0;

async function failImportVideo(itemId: string, error: string): Promise<void> {
  "use step";
  await db
    .update(channelImportItem)
    .set({ status: "failed", error })
    .where(
      and(
        eq(channelImportItem.id, itemId),
        inArray(channelImportItem.status, ["queued", "processing"]),
      ),
    );
}

async function completeImport(jobId: string): Promise<void> {
  "use step";
  await db
    .update(channelImport)
    .set({ status: "completed", error: null, finishedAt: new Date() })
    .where(eq(channelImport.id, jobId));
}

async function failImport(jobId: string, error: string): Promise<void> {
  "use step";
  await db.transaction(async (tx) => {
    await tx
      .update(channelImportItem)
      .set({ status: "failed", error })
      .where(
        and(
          eq(channelImportItem.jobId, jobId),
          eq(channelImportItem.status, "processing"),
        ),
      );
    await tx
      .update(channelImport)
      .set({ status: "failed", error, finishedAt: new Date() })
      .where(eq(channelImport.id, jobId));
  });
}
