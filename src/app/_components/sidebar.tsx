"use client";

import { UserButton } from "@clerk/nextjs";
import {
  Library,
  MessageSquare,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { useRef, useState } from "react";

import { ChatItem } from "~/app/_components/chat-item";
import { removeChat, renameChat } from "~/app/_components/chat-list";
import { ThemeToggle } from "~/app/_components/theme-toggle";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "~/components/ui/sidebar";
import { api } from "~/trpc/react";

/** Responsive app navigation with persistent desktop collapse and a mobile drawer. */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const utils = api.useUtils();
  const { setOpenMobile, state } = useSidebar();
  const [activeId, setActiveId] = useQueryState("id");
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const deletedActiveChat = useRef<string | null>(null);
  const threads = api.chats.list.useQuery();

  const rename = api.chats.rename.useMutation({
    onMutate: async ({ threadId, title }) => {
      setChatActionError(null);
      await utils.chats.list.cancel();
      const previous = utils.chats.list.getData();
      utils.chats.list.setData(undefined, (current) =>
        current ? renameChat(current, threadId, title) : current,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      utils.chats.list.setData(undefined, context?.previous);
      setChatActionError(error.message || "Couldn't rename chat");
    },
    onSettled: () => void utils.chats.list.invalidate(),
  });

  const remove = api.chats.delete.useMutation({
    onMutate: async ({ threadId }) => {
      setChatActionError(null);
      await utils.chats.list.cancel();
      const previous = utils.chats.list.getData();
      utils.chats.list.setData(undefined, (current) =>
        current ? removeChat(current, threadId) : current,
      );
      return { previous };
    },
    onError: (error, { threadId }, context) => {
      utils.chats.list.setData(undefined, context?.previous);
      setChatActionError(error.message || "Couldn't delete chat");
      if (deletedActiveChat.current === threadId) {
        deletedActiveChat.current = null;
        void setActiveId(threadId);
      }
    },
    onSuccess: (_data, { threadId }) => {
      if (deletedActiveChat.current === threadId) {
        deletedActiveChat.current = null;
      }
    },
    onSettled: () => void utils.chats.list.invalidate(),
  });

  const onChats = pathname === "/chats";

  function newChat() {
    setOpenMobile(false);
    deletedActiveChat.current = null;
    if (onChats) void setActiveId(null);
    else router.push("/chats");
  }

  function selectThread(id: string) {
    setOpenMobile(false);
    deletedActiveChat.current = null;
    if (onChats) void setActiveId(id);
    else router.push(`/chats?id=${id}`);
  }

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:justify-center">
          <SidebarMenu className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="Nexus">
                <Link href="/chats" onClick={() => setOpenMobile(false)}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <Sparkles className="size-4" />
                  </span>
                  <span className="text-base font-semibold">Nexus</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger
            aria-label={state === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            title={state === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            className="shrink-0 group-data-[collapsible=icon]:mx-auto"
          />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={newChat} tooltip="New chat">
              <Plus />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={onChats} tooltip="Chats">
                  <Link href="/chats" onClick={() => setOpenMobile(false)}>
                    <MessageSquare />
                    <span>Chats</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === "/sources"}
                  tooltip="Sources"
                >
                  <Link href="/sources" onClick={() => setOpenMobile(false)}>
                    <Library />
                    <span>Sources</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
          <SidebarGroupContent>
            {threads.isLoading ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">Loading…</p>
            ) : threads.data && threads.data.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {threads.data.map((thread) => (
                  <ChatItem
                    key={thread.id}
                    thread={thread}
                    isActive={onChats && activeId === thread.id}
                    onSelect={selectThread}
                    onDelete={(id) => {
                      if (onChats && activeId === id) {
                        deletedActiveChat.current = id;
                        void setActiveId(null);
                      }
                      remove.mutate({ threadId: id });
                    }}
                    onRename={(id, title) =>
                      rename.mutate({ threadId: id, title })
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                No chats yet.
              </p>
            )}
            {chatActionError ? (
              <p
                role="alert"
                className="px-2 pt-2 text-xs text-destructive"
              >
                {chatActionError}
              </p>
            ) : null}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Account" size="lg">
              <div>
                <UserButton appearance={{ elements: { avatarBox: "size-7" } }} />
                <span>Account</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  );
}
