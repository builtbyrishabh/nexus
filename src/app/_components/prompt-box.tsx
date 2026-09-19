"use client";

import { type ChatStatus } from "ai";
import { useState } from "react";

import { MAX_CHAT_TEXT_LENGTH } from "~/lib/chat-limits";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "~/components/ai-elements/prompt-input";

/** Shared AI Elements composer for the empty and active conversation surfaces. */
export function PromptBox({
  onSubmit,
  onStop,
  status = "ready",
  defaultValue,
  placeholder = "Ask a question…",
  autoFocus,
}: {
  onSubmit: (text: string) => void;
  onStop?: () => void;
  status?: ChatStatus;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(defaultValue ?? "");
  const busy = status === "submitted" || status === "streaming";

  return (
    <PromptInput
      className="rounded-2xl shadow-sm"
      onSubmit={({ text: submitted }) => {
        const value = submitted.trim();
        if (!value || busy) return;
        onSubmit(value);
        setText("");
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          autoFocus={autoFocus}
          disabled={busy}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder={placeholder}
          className="min-h-12 py-3 text-base"
          maxLength={MAX_CHAT_TEXT_LENGTH}
        />
      </PromptInputBody>
      <PromptInputFooter className="justify-end pt-0">
        {busy && onStop ? (
          <PromptInputSubmit
            type="button"
            status={status}
            onClick={onStop}
            aria-label="Stop generating"
          />
        ) : (
          <PromptInputSubmit
            status="ready"
            disabled={!text.trim()}
            aria-label="Send message"
          />
        )}
      </PromptInputFooter>
    </PromptInput>
  );
}
