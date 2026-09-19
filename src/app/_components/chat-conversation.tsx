"use client";

import { useChat } from "@ai-sdk/react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CitedAnswer,
  citationRegistry,
  copyableAnswerText,
  textOf,
} from "~/app/_components/answer";
import { PromptBox } from "~/app/_components/prompt-box";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "~/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "~/components/ai-elements/message";
import { api } from "~/trpc/react";
import { CHAT_LENGTH_ERROR, CHAT_QUOTA_ERROR } from "~/lib/chat-limits";

/** One live AI SDK conversation, keyed by its persisted Mastra thread. */
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
    clearError,
  } = useChat<UIMessage>({
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
      if (!hadHistoryRef.current) {
        hadHistoryRef.current = true;
        void utils.chats.list.invalidate();
      }
    },
  });

  const sentSeedRef = useRef(false);
  const knownError = error
    ? [CHAT_QUOTA_ERROR, CHAT_LENGTH_ERROR].find((message) =>
        error.message.includes(message),
      )
    : undefined;
  useEffect(() => {
    if (sentSeedRef.current || !seed || initialMessages.length > 0) return;
    sentSeedRef.current = true;
    void sendMessage({ text: seed });
    // The seed belongs to this mounted thread and must be sent once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const waiting =
    status === "submitted" && messages.at(-1)?.role === "user";
  const citations = useMemo(() => citationRegistry(messages), [messages]);

  async function copyAnswer(message: UIMessage) {
    await navigator.clipboard.writeText(copyableAnswerText(textOf(message)));
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1_500);
  }

  function retryLastResponse() {
    clearError();
    void regenerate();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Conversation className="min-h-0 min-w-0">
        <ConversationContent className="mx-auto w-full max-w-[52rem] gap-7 px-4 py-8 md:px-6">
          {messages.map((message) => {
            const answer = textOf(message);
            const isCurrentAssistant =
              message.role === "assistant" &&
              message.id === messages.at(-1)?.id;

            return (
              <Message
                key={message.id}
                from={message.role}
                className={
                  message.role === "user"
                    ? "max-w-[85%]"
                    : "min-w-0 max-w-full"
                }
              >
                <MessageContent
                  className={
                    message.role === "assistant"
                      ? "w-full min-w-0 overflow-visible text-base"
                      : undefined
                  }
                >
                  {message.role === "assistant" ? (
                    <CitedAnswer
                      text={answer}
                      citations={citations}
                      showSources={status !== "streaming" || !isCurrentAssistant}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {answer}
                    </p>
                  )}
                </MessageContent>

                {message.role === "assistant" &&
                  answer &&
                  (!isCurrentAssistant || status === "ready") && (
                    <MessageActions>
                      <MessageAction
                        tooltip={copiedId === message.id ? "Copied" : "Copy answer"}
                        onClick={() => void copyAnswer(message)}
                      >
                        {copiedId === message.id ? <Check /> : <Copy />}
                      </MessageAction>
                    </MessageActions>
                  )}
              </Message>
            );
          })}

          {waiting && (
            <Message from="assistant" className="max-w-full">
              <MessageContent className="text-muted-foreground">
                <span className="animate-pulse">Thinking…</span>
              </MessageContent>
            </Message>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">
                {knownError ?? "Nexus couldn't finish that response."}
              </p>
              {!knownError && (
                <button
                  type="button"
                  onClick={retryLastResponse}
                  className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
                >
                  <RotateCcw className="size-3.5" /> Retry response
                </button>
              )}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton className="bottom-3 z-10 shadow-sm" />
      </Conversation>

      <div className="shrink-0 bg-background/95 px-4 pb-4 pt-2 backdrop-blur md:px-6">
        <div className="mx-auto w-full max-w-[52rem]">
          <PromptBox
            compact
            status={status}
            onStop={stop}
            onSubmit={(text) => void sendMessage({ text })}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Answers are grounded in your sources. Check citations for important details.
          </p>
        </div>
      </div>
    </div>
  );
}
