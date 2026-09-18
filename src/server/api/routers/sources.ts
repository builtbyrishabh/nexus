import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listLibraryCreators } from "~/server/domain/source-library";
import { listChannelImports } from "~/server/imports/channel-import";

/** Source-library reads, always scoped through Clerk ownership. */
export const sourcesRouter = createTRPCRouter({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const [creators, imports] = await Promise.all([
      listLibraryCreators(ctx.userId),
      listChannelImports(ctx.userId),
    ]);
    return { creators, imports };
  }),
});
