import "server-only";

import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { TRPCError } from "@trpc/server";
import type { UIMessage } from "ai";

import { nexusMemory } from "~/server/mastra";

export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listUserThreads(userId: string): Promise<ThreadSummary[]> {
  const { threads } = await nexusMemory.listThreads({
    filter: { resourceId: userId },
    orderBy: { field: "updatedAt", direction: "DESC" },
    perPage: 100,
  });
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title?.trim() ? thread.title : "New chat",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }));
}

/** Reject an existing thread owned by another user; a new client-minted thread is allowed. */
export async function assertThreadOwner(threadId: string, userId: string) {
  const thread = await nexusMemory.getThreadById({ threadId });
  if (!thread) return null;
  if (thread.resourceId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return thread;
}

/** Load the native persisted message parts used by AI SDK `useChat`. */
export async function loadThreadMessages(
  threadId: string,
  userId: string,
): Promise<UIMessage[]> {
  const thread = await assertThreadOwner(threadId, userId);
  if (!thread) return [];

  const { messages } = await nexusMemory.recall({
    threadId,
    resourceId: userId,
    perPage: false,
  });

  return toAISdkMessages(messages, { version: "v7" }).filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
}

export async function renameThread(
  threadId: string,
  userId: string,
  title: string,
) {
  await assertThreadOwner(threadId, userId);
  await nexusMemory.updateThread({ id: threadId, title: title.trim() });
}

export async function deleteThread(threadId: string, userId: string) {
  await assertThreadOwner(threadId, userId);
  await nexusMemory.deleteThread(threadId);
}
