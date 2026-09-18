import "~/styles/globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import { type Metadata } from "next";
import { Geist } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: {
    default: "Nexus — ask a creator's catalog",
    template: "%s · Nexus",
  },
  description:
    "Grounded, cited answers from a YouTube creator's own videos — every claim deep-links to the second it was said.",
  applicationName: "Nexus",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "64x64" },
      { url: "/nexus-logo.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en" className={geist.variable} suppressHydrationWarning>
        <body className="bg-canvas text-ink antialiased">
          <TRPCReactProvider>
            <NuqsAdapter>{children}</NuqsAdapter>
          </TRPCReactProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
