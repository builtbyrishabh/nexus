"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

type Thread = RouterOutputs["chats"]["list"][number];

/**
 * One row in the sidebar. The title is a plain `?id=` link (shareable, and a shallow nuqs flip via
 * the sidebar's own handler keeps it instant). A hover menu renames (inline) or deletes.
 */
export function ChatItem({
  thread,
  isActive,
  onSelect,
  onDeleted,
}: {
  thread: Thread;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const utils = api.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const rename = api.chats.rename.useMutation({
    onSuccess: () => utils.chats.list.invalidate(),
  });
  const remove = api.chats.delete.useMutation({
    onSuccess: () => utils.chats.list.invalidate(),
  });

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function commitRename() {
    const title = draft.trim();
    setRenaming(false);
    if (title && title !== thread.title) {
      rename.mutate({ threadId: thread.id, title });
    } else {
      setDraft(thread.title);
    }
  }

  if (renaming) {
    return (
      <div className="px-2 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(thread.title);
              setRenaming(false);
            }
          }}
          className="w-full rounded-lg border border-accent bg-elevated px-2 py-1.5 text-sm text-ink focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={`group relative flex items-center rounded-lg ${
        isActive ? "bg-accent-soft" : "hover:bg-surface"
      }`}
    >
      <Link
        href={`/chats?id=${thread.id}`}
        onClick={(e) => {
          e.preventDefault();
          onSelect(thread.id);
        }}
        className={`min-w-0 flex-1 truncate px-3 py-2 text-sm ${
          isActive ? "text-ink" : "text-muted group-hover:text-ink"
        }`}
        title={thread.title}
      >
        {thread.title}
      </Link>

      <button
        type="button"
        aria-label="Chat options"
        onClick={() => setMenuOpen((v) => !v)}
        className="mr-1 hidden size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-line hover:text-ink group-hover:grid data-[open=true]:grid"
        data-open={menuOpen}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="absolute right-1 top-9 z-20 w-32 overflow-hidden rounded-lg border border-line bg-elevated py-1 text-sm shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-ink hover:bg-surface"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                remove.mutate({ threadId: thread.id });
                onDeleted(thread.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-red-500 hover:bg-surface"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
