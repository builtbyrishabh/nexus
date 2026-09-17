import { Sidebar } from "~/app/_components/sidebar";

// The signed-in chat lives behind this shell. Depends on the current user, so never prerender.
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-dvh bg-canvas">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {children}
      </main>
    </div>
  );
}
