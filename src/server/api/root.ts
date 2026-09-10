import { chatsRouter } from "~/server/api/routers/chats";
import {
  createCallerFactory,
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * The chat *streaming* path runs through the `/api/chat` route handler, not tRPC. tRPC owns the
 * sidebar's thread CRUD (`chats`) plus a `health` probe.
 */
export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({ ok: true })),
  chats: chatsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 */
export const createCaller = createCallerFactory(appRouter);
