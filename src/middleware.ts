import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything is behind auth except the landing redirect and Clerk's own sign-in/up routes.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)",
    // Always run for API/tRPC routes so `auth()` is available in the chat route + tRPC context.
    "/(api|trpc)(.*)",
  ],
};
