import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Keep `/` useful for first-time production visitors as well as returning users. Sending a signed-
// out request through a protected route first can produce a Clerk development-instance rewrite
// before the browser has established its session cookie.
export default async function RootPage() {
  const { userId } = await auth();
  redirect(userId ? "/chats" : "/sign-in");
}
