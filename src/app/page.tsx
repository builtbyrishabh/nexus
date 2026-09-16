import { redirect } from "next/navigation";

// The product lives behind the app shell. `/` just funnels into it: signed-in users land on the
// chat, signed-out users are redirected to sign-in by the middleware guarding `/chats`.
export default function RootPage() {
  redirect("/chats");
}
