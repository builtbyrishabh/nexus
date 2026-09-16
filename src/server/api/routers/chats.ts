import { z } from "zod";

import {
  deleteThread,
  listUserThreads,
  loadThreadMessages,
  renameThread,
} from "~/server/chat/threads";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

// Threads are client-minted UUIDs (crypto.randomUUID) so a chat's storage prefix exists before
// its first turn persists.
const threadIdSchema = z.string().uuid();

/**
 * The chat sidebar's CRUD, all scoped to the signed-in user via Mastra Memory's `resourceId`.
 * Every procedure is a thin wrapper over `~/server/chat/threads` — the one place thread ops live,
 * shared with the streaming `/api/chat` route.
 */
export const chatsRouter = createTRPCRouter({
  /** Threads for the sidebar, newest first. */
  list: protectedProcedure.query(({ ctx }) => listUserThreads(ctx.userId)),

  /** A thread's history as UI messages (empty for a not-yet-persisted or unknown thread). */
  messages: protectedProcedure
    .input(z.object({ threadId: threadIdSchema }))
    .query(({ ctx, input }) => loadThreadMessages(input.threadId, ctx.userId)),

  rename: protectedProcedure
    .input(z.object({ threadId: threadIdSchema, title: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      renameThread(input.threadId, ctx.userId, input.title),
    ),

  delete: protectedProcedure
    .input(z.object({ threadId: threadIdSchema }))
    .mutation(({ ctx, input }) => deleteThread(input.threadId, ctx.userId)),
});
