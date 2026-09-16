"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryState } from "nuqs";

import { ChatItem } from "~/app/_components/chat-item";
import { api } from "~/trpc/react";

/**
 * The app-shell sidebar: new chat, the Panel surface, the thread list, and the Clerk user button.
 * It shares the `?id=` query param with the chats page (same nuqs adapter), so selecting a thread
 * on `/chats` is a shallow flip — no route change, no remount. From another surface (`/panel`) it
 * falls back to a normal navigation into `/chats?id=`.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [activeId, setActiveId] = useQueryState("id");
  const threads = api.chats.list.useQuery();

  const onChats = pathname === "/chats";

  function newChat() {
    if (onChats) void setActiveId(null);
    else router.push("/chats");
  }

  function selectThread(id: string) {
    if (onChats) void setActiveId(id);
    else router.push(`/chats?id=${id}`);
  }

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/chats" className="text-lg font-semibold text-ink">
          Nexus
        </Link>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-sm font-medium text-ink transition hover:border-accent"
        >
          <span className="text-accent">＋</span> New chat
        </button>
      </div>

      <nav className="px-3 py-3">
        <Link
          href="/panel"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            pathname === "/panel"
              ? "bg-accent-soft text-ink"
              : "text-muted hover:bg-surface hover:text-ink"
          }`}
        >
          <span aria-hidden>◱</span> Panel
        </Link>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">
          Chats
        </p>
        {threads.isLoading ? (
          <p className="px-3 py-2 text-sm text-muted">Loading…</p>
        ) : threads.data && threads.data.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {threads.data.map((thread) => (
              <ChatItem
                key={thread.id}
                thread={thread}
                isActive={onChats && activeId === thread.id}
                onSelect={selectThread}
                onDeleted={(id) => {
                  if (activeId === id) void setActiveId(null);
                }}
              />
            ))}
          </div>
        ) : (
          <p className="px-3 py-2 text-sm text-muted">No chats yet.</p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
        <span className="text-sm text-muted">Account</span>
      </div>
    </aside>
  );
}
