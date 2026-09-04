import {
  createCallerFactory,
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * The Slice 0 chat path runs through the `/api/chat` route handler (streaming), not tRPC.
 * A single `health` procedure keeps the tRPC scaffold wired for future routers.
 */
export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({ ok: true })),
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 */
export const createCaller = createCallerFactory(appRouter);
