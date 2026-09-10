import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/chats" />
    </main>
  );
}
