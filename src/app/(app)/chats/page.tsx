"use client";

import { useQueryState } from "nuqs";
import { Suspense, useState } from "react";
import Link from "next/link";

import { ChatConversation } from "~/app/_components/chat-conversation";
import { PromptBox } from "~/app/_components/prompt-box";
import { firstCreatorName } from "~/app/_components/source-view";
import { api } from "~/trpc/react";

const newThreadId = () => crypto.randomUUID();

/**
 * The chat SPA. One mounted page holds both the empty "new chat" surface and the live
 * conversation; the active thread lives in `?id=`. Starting or switching a chat is a shallow nuqs
 * flip (no route change, no RSC round-trip, no remount of this page) — instant. A carried `?q=`
 * prompt seeds the composer once.
 */
function ChatsHarness() {
  const utils = api.useUtils();
  const [activeId, setActiveId] = useQueryState("id");
  const [seedPrompt, setSeedPrompt] = useQueryState("q");

  // A thread id minted up front so a brand-new chat has a stable id before its first turn persists.
  const [draftThreadId, setDraftThreadId] = useState(newThreadId);
  const [committedSeed, setCommittedSeed] = useState<{
    threadId: string;
    text: string;
  } | null>(null);

  const messagesQuery = api.chats.messages.useQuery(
    { threadId: activeId ?? "" },
    { enabled: Boolean(activeId) },
  );
  const sourcesQuery = api.imports.sources.useQuery();

  function startChat(text: string) {
    const threadId = draftThreadId;
    // Set the seed synchronously, before the `?id=` flip, so the conversation renders with it on
    // the first frame — no gap.
    setCommittedSeed({ threadId, text });
    const now = new Date();
    utils.chats.list.setData(undefined, (prev) => [
      {
        id: threadId,
        title: text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text,
        createdAt: now,
        updatedAt: now,
      },
      ...(prev ?? []),
    ]);

    void setActiveId(threadId); // shallow by default — page stays mounted
    if (seedPrompt !== null) void setSeedPrompt(null);
    setDraftThreadId(newThreadId());
  }

  if (!activeId) {
    const firstCreator = firstCreatorName(sourcesQuery.data ?? []);
    const suggestions = firstCreator
      ? [
          `What are ${firstCreator}'s most important ideas?`,
          `What advice does ${firstCreator} repeat most often?`,
          `Summarize ${firstCreator}'s approach in practical steps.`,
        ]
      : [];

    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-2xl">
          <h1 className="mb-2 text-center text-3xl font-semibold text-foreground">
            Ask the catalog
          </h1>
          <p className="mb-8 text-center text-muted-foreground">
            Grounded, cited answers from a creator&apos;s own videos — every claim
            deep-links to the second it was said.
          </p>
          <PromptBox
            autoFocus
            defaultValue={seedPrompt ?? undefined}
            placeholder="Ask a question…"
            onSubmit={startChat}
          />
          {sourcesQuery.data?.length === 0 ? (
            <div className="mt-5 text-center text-sm text-muted-foreground">
              Your library is empty.{" "}
              <Link href="/sources" className="font-medium text-primary hover:underline">
                Add your first source
              </Link>{" "}
              to get grounded answers.
            </div>
          ) : suggestions.length > 0 ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => startChat(suggestion)}
                  className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const seedForActive =
    committedSeed?.threadId === activeId ? committedSeed.text : null;

  if (messagesQuery.isLoading) {
    return <ChatSkeleton />;
  }

  return (
    <ChatConversation
      key={activeId}
      threadId={activeId}
      initialMessages={messagesQuery.data ?? []}
      seed={seedForActive}
    />
  );
}

function ChatSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
      <div className="h-10 w-2/3 animate-pulse self-end rounded-2xl bg-muted" />
      <div className="h-24 w-4/5 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

export default function ChatsPage() {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatsHarness />
    </Suspense>
  );
}
