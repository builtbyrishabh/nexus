"use client";

import { useEffect, useRef, useState } from "react";

import type { ChatStatus } from "ai";

/**
 * The one composer, used both on the empty "new chat" surface and inside a live conversation.
 * Enter sends, Shift+Enter makes a newline. While a reply is streaming the send button becomes a
 * stop button. Uncontrolled (`defaultValue`) so a carried-over `?q=` prompt can prefill it.
 */
export function PromptBox({
  onSubmit,
  onStop,
  status = "ready",
  defaultValue,
  placeholder = "Ask a question…",
  autoFocus,
  compact,
}: {
  onSubmit: (text: string) => void;
  onStop?: () => void;
  status?: ChatStatus;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState(defaultValue ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";

  // Auto-grow the textarea to its content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function submit() {
    const q = text.trim();
    if (!q || busy) return;
    onSubmit(q);
    setText("");
  }

  return (
    <div
      className={`flex items-end gap-2 rounded-2xl border border-line bg-elevated p-2 shadow-sm focus-within:border-accent ${
        compact ? "" : "shadow-md"
      }`}
    >
      <textarea
        ref={ref}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-ink placeholder:text-muted focus:outline-none"
      />
      {busy && onStop ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white hover:opacity-90"
        >
          <span className="size-3 rounded-[3px] bg-white" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || busy}
          aria-label="Send"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:opacity-90 disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 19V5M12 5l-6 6M12 5l6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
