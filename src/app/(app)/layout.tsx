import { cookies } from "next/headers";

import { Sidebar } from "~/app/_components/sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";

// The signed-in chat lives behind this shell. Depends on the current user, so never prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const defaultSidebarOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <Sidebar />
      <SidebarInset className="h-dvh min-w-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center border-b px-3 md:px-4">
          <SidebarTrigger aria-label="Toggle navigation" />
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
