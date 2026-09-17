"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef } from "react";

import {
  AnswerText,
  citationRegistry,
  textOf,
} from "~/app/_components/answer";
import { PromptBox } from "~/app/_components/prompt-box";
import { api } from "~/trpc/react";

/**
 * One live conversation. Keyed by `threadId` upstream, so switching threads mounts a fresh
 * `useChat` (its own stream) while the chats *page* stays mounted (the `?id=` flip is shallow).
 *
 * The transport sends only the newest user message + `threadId`: the full history lives in Mastra
 * Memory server-side, so there's nothing to re-upload. A `seed` (the first prompt of a brand-new
 * chat, carried over from the home surface) is auto-sent once on mount.
 */
export function ChatConversation({
  threadId,
  initialMessages,
  seed,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  seed?: string | null;
}) {
  const utils = api.useUtils();
  const hadHistoryRef = useRef(initialMessages.length > 0);

  const { messages, sendMessage, status, stop, error } = useChat<UIMessage>({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages, id, body }) => ({
        body: { message: messages.at(-1), threadId: id, ...body },
      }),
    }),
    onFinish: () => {
      void utils.chats.messages.invalidate({ threadId });
      // First reply of a fresh thread: it now exists + has a title, so refresh the sidebar.
      if (!hadHistoryRef.current) {
        hadHistoryRef.current = true;
        void utils.chats.list.invalidate();
      }
    },
  });

  const sentSeedRef = useRef(false);
  useEffect(() => {
    if (sentSeedRef.current || !seed || initialMessages.length > 0) return;
    sentSeedRef.current = true;
    void sendMessage({ text: seed });
    // Only ever fires once per mounted thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const lastPart = messages.at(-1)?.parts.at(-1);
  const waiting =
    status === "submitted" ||
    (status === "streaming" &&
      (lastPart?.type !== "text" || !lastPart.text.trim()));
  const citations = useMemo(() => citationRegistry(messages), [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
          {messages.map((message) => {
            const text = textOf(message);
            if (message.role === "assistant" && !text.trim()) return null;
            return (
              <div
                key={message.id}
                className={
                  message.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                {message.role === "user" ? (
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-white">
                    {text}
                  </p>
                ) : (
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-ink">
                    <AnswerText text={text} citations={citations} />
                  </div>
                )}
              </div>
            );
          })}

          {waiting && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-muted">
                Thinking…
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500">
              Something went wrong. Please try again.
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-canvas px-4 py-4">
        <div className="mx-auto max-w-3xl">
          <PromptBox
            compact
            status={status}
            onStop={stop}
            onSubmit={(text) => void sendMessage({ text })}
          />
        </div>
      </div>
    </div>
  );
}
