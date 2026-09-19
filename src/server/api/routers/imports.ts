import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  listOwnedSources,
  removeOwnedSource,
} from "~/server/domain/source-library";
import { canRetryImport } from "~/server/domain/channel-import";
import {
  getChannelImport,
  ImportNotFoundError,
  ImportNotRetryableError,
  listChannelImports,
  previewChannelImport,
  retryFailedChannelImport,
  startChannelImport,
} from "~/server/imports/channel-import";
import { consumeDailyQuota } from "~/server/usage-quota";

const jobIdSchema = z.string().uuid();

/** Authenticated channel-import operations; ownership is always derived from Clerk context. */
export const importsRouter = createTRPCRouter({
  preview: protectedProcedure
    .input(z.object({ scope: z.string().trim().min(1).max(500) }))
    .query(({ input }) => previewChannelImport(input.scope)),

  list: protectedProcedure.query(({ ctx }) => listChannelImports(ctx.userId)),

  sources: protectedProcedure.query(({ ctx }) => listOwnedSources(ctx.userId)),

  removeSource: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await removeOwnedSource(ctx.userId, input.sourceId);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
      return { removed: true as const };
    }),

  start: protectedProcedure
    .input(z.object({ scope: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await consumeDailyQuota(ctx.userId, "import"))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Daily import limit reached" });
      }
      return startChannelImport(ctx.userId, input.scope);
    }),

  byId: protectedProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .query(async ({ ctx, input }) => {
      const job = await getChannelImport(ctx.userId, input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      return job;
    }),

  retryFailures: protectedProcedure
    .input(z.object({ jobId: jobIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const job = await getChannelImport(ctx.userId, input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canRetryImport(job.status, job.summary.failed)) {
        throw new TRPCError({ code: "CONFLICT" });
      }
      if (!(await consumeDailyQuota(ctx.userId, "import"))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Daily import limit reached" });
      }
      try {
        return await retryFailedChannelImport(ctx.userId, input.jobId);
      } catch (error) {
        if (error instanceof ImportNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (error instanceof ImportNotRetryableError) {
          throw new TRPCError({ code: "CONFLICT" });
        }
        throw error;
      }
    }),
});
