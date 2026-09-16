import "server-only";

import { randomUUID } from "node:crypto";

import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import { Memory } from "@mastra/memory";
import { TRPCError } from "@trpc/server";

import type { Citation } from "~/server/domain/types";
import type { NexusUIMessage } from "~/server/domain/ui";
import { storage } from "~/server/mastra";

/**
 * The chat sidebar's thread + history layer, built entirely on Mastra Memory (Slice 5).
 *
 * This is the ONE place thread operations live, so the streaming route (`/api/chat`) and the
 * `chats` tRPC router share the exact same persistence contract — no second copy to drift.
 *
 * Design note (load-bearing): we persist the user's *plain question* and the assistant's answer
 * (+ its citations) — never the evidence packet. That clean history serves two readers: the
 * sidebar (thread list + rehydration) and, via `recallModelMessages`, the model itself, which now
 * receives prior turns as conversational context so it can resolve references across turns.
 *
 * The boundary that stays fixed: history is context for *generation only*. Retrieval still runs on
 * the current question alone, and every claim is still grounded in — and cited to — the current
 * turn's Evidence. History is never a retrieval input and never a grounding source, so the refusal
 * contract and the eval (which runs single-turn, no history) are untouched.
 */

// One Memory instance over the shared Postgres storage. Cheap to construct, but a singleton keeps
// connection/setup work down across requests.
let memorySingleton: Memory | undefined;
export function getNexusMemory(): Memory {
  return (memorySingleton ??= new Memory({ storage }));
}

/** A deterministic thread title from the first question — no extra LLM call. */
export function titleFromQuestion(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 60 ? `${clean.slice(0, 60).trimEnd()}…` : clean;
}

/** A thread summary for the sidebar. */
export type ThreadSummary = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listUserThreads(userId: string): Promise<ThreadSummary[]> {
  const { threads } = await getNexusMemory().listThreads({
    filter: { resourceId: userId },
    orderBy: { field: "updatedAt", direction: "DESC" },
    perPage: 100,
  });
  return threads.map((t) => ({
    id: t.id,
    title: t.title?.trim() ? t.title : "New chat",
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

/**
 * Confirm the thread belongs to `userId`. Returns null when the thread doesn't exist yet (a
 * freshly-created chat whose first turn hasn't persisted); throws NOT_FOUND when it exists but
 * belongs to someone else, so a thread id can never be probed across users.
 */
async function assertOwnership(threadId: string, userId: string) {
  const thread = await getNexusMemory().getThreadById({ threadId });
  if (!thread) return null;
  if (thread.resourceId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return thread;
}

/** Load a thread's history as UI messages ready to seed `useChat`. Empty for unknown threads. */
export async function loadThreadMessages(
  threadId: string,
  userId: string,
): Promise<NexusUIMessage[]> {
  const thread = await assertOwnership(threadId, userId);
  if (!thread) return [];
  const { messages } = await getNexusMemory().recall({
    threadId,
    resourceId: userId,
    perPage: false,
  });
  const ui = toAISdkMessages(messages, { version: "v6" });
  return ui
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
    })) as unknown as NexusUIMessage[];
}

/**
 * The thread's prior turns as plain model messages (text only), oldest→newest, ready to prepend to
 * the current turn for conversational recall. Because we only ever store the plain question + answer
 * (no evidence), this is exactly the clean context the model should see — the current turn's Evidence
 * packet is added separately by `ask()`. Empty for a fresh or unknown thread.
 */
export async function recallModelMessages(
  threadId: string,
  userId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const ui = await loadThreadMessages(threadId, userId);
  return ui
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(""),
    }))
    .filter((m) => m.content.trim().length > 0);
}

export async function renameThread(
  threadId: string,
  userId: string,
  title: string,
) {
  await assertOwnership(threadId, userId);
  await getNexusMemory().updateThread({ id: threadId, title: titleFromQuestion(title) });
}

export async function deleteThread(threadId: string, userId: string) {
  await assertOwnership(threadId, userId);
  await getNexusMemory().deleteThread(threadId);
}

/**
 * Persist one completed turn: the plain question and the grounded answer (with its citations, so
 * the `[n]` deep-links survive a reload — verified round-trip). Upserts the thread on the first
 * turn, titling it from the question. Best-effort by contract: the caller runs this after the
 * answer has already streamed, so a store hiccup must never fail the response.
 */
export async function persistTurn(input: {
  threadId: string;
  userId: string;
  question: string;
  answer: string;
  citations: Citation[];
  userMessageId?: string;
}): Promise<void> {
  const { threadId, userId, question, answer, citations, userMessageId } = input;
  const memory = getNexusMemory();
  const now = new Date();

  const existing = await memory.getThreadById({ threadId });
  if (!existing) {
    await memory.saveThread({
      thread: {
        id: threadId,
        resourceId: userId,
        title: titleFromQuestion(question),
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    });
  } else if (existing.resourceId !== userId) {
    // Never write into another user's thread.
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  const messages = [
    {
      id: userMessageId ?? randomUUID(),
      role: "user",
      createdAt: new Date(now.getTime()),
      threadId,
      resourceId: userId,
      content: { format: 2, parts: [{ type: "text", text: question }] },
    },
    {
      id: randomUUID(),
      role: "assistant",
      createdAt: new Date(now.getTime() + 1),
      threadId,
      resourceId: userId,
      content: {
        format: 2,
        parts: [
          { type: "data-citations", data: citations },
          { type: "text", text: answer },
        ],
        metadata: { citations },
      },
    },
  ];

  // Shape verified against the live store in scripts/_memory-roundtrip; cast past the internal
  // MastraDBMessage type (its data-part union isn't exported in a convenient form).
  await memory.saveMessages({
    messages: messages as unknown as Parameters<Memory["saveMessages"]>[0]["messages"],
  });
}
