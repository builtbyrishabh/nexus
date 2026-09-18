import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getSourceOverview } from "~/server/sources/source-management";

/** Source-library reads, always scoped through Clerk ownership. */
export const sourcesRouter = createTRPCRouter({
  overview: protectedProcedure.query(({ ctx }) =>
    getSourceOverview(ctx.userId),
  ),
});
