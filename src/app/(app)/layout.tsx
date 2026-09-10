import { Sidebar } from "~/app/_components/sidebar";

// The signed-in surfaces (chat + panel) all live behind the same shell. Depends on the current
// user, so never prerender.
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-dvh bg-canvas">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
