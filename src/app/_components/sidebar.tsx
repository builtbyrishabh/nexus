"use client";

import { UserButton } from "@clerk/nextjs";
import {
  Library,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryState } from "nuqs";

import { ChatItem } from "~/app/_components/chat-item";
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
  useSidebar,
} from "~/components/ui/sidebar";
import { api } from "~/trpc/react";

/** Responsive app navigation with persistent desktop collapse and a mobile drawer. */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile, state, toggleSidebar } = useSidebar();
  const [activeId, setActiveId] = useQueryState("id");
  const threads = api.chats.list.useQuery();

  const onChats = pathname === "/chats";

  function newChat() {
    setOpenMobile(false);
    if (onChats) void setActiveId(null);
    else router.push("/chats");
  }

  function selectThread(id: string) {
    setOpenMobile(false);
    if (onChats) void setActiveId(id);
    else router.push(`/chats?id=${id}`);
  }

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
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
                    onDeleted={(id) => {
                      if (activeId === id) void setActiveId(null);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                No chats yet.
              </p>
            )}
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
          <SidebarMenuItem className="hidden md:block">
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip={state === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
            >
              {state === "expanded" ? <PanelLeftClose /> : <PanelLeftOpen />}
              <span>
                {state === "expanded" ? "Collapse sidebar" : "Expand sidebar"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  );
}
