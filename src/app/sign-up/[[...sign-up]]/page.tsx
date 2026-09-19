import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/chats" />
    </main>
  );
}
