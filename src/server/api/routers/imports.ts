import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  getChannelImport,
  ImportNotFoundError,
  ImportNotRetryableError,
  retryFailedChannelImport,
  startChannelImport,
} from "~/server/imports/channel-import";

const jobIdSchema = z.string().uuid();

/** Authenticated channel-import operations; ownership is always derived from Clerk context. */
export const importsRouter = createTRPCRouter({
  start: protectedProcedure
    .input(z.object({ scope: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }) => startChannelImport(ctx.userId, input.scope)),

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
