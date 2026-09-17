import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  getSourceOverview,
  previewYoutubeSource,
  removeLibraryCreator,
  SourceRemovalConflictError,
} from "~/server/sources/source-management";

const sourceScopeSchema = z.string().trim().min(1).max(500);

/** Source-library reads and mutations, always scoped through Clerk ownership. */
export const sourcesRouter = createTRPCRouter({
  overview: protectedProcedure.query(({ ctx }) =>
    getSourceOverview(ctx.userId),
  ),

  preview: protectedProcedure
    .input(z.object({ scope: sourceScopeSchema }))
    .mutation(async ({ input }) => {
      try {
        return await previewYoutubeSource(input.scope);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "We could not resolve that YouTube source. Check the URL, handle, or channel ID.",
        });
      }
    }),

  removeCreator: protectedProcedure
    .input(z.object({ creatorHandle: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeLibraryCreator(ctx.userId, input.creatorHandle);
      } catch (error) {
        if (error instanceof SourceRemovalConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),
});
