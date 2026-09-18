import { auth } from "@clerk/nextjs/server";
import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { TRPCError } from "@trpc/server";
import { createUIMessageStreamResponse } from "ai";

import { parseChatRequest } from "~/app/api/chat/request";
import { assertThreadOwner } from "~/server/chat/threads";
import {
  loadSourceLibrary,
  type NexusRequestContext,
} from "~/server/domain/source-library";
import { mastra, NEXUS_MAX_STEPS } from "~/server/mastra";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsed = await parseChatRequest(await req.json().catch(() => null));
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const { message, threadId } = parsed.request;
  try {
    await assertThreadOwner(threadId, userId);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }

  const library = await loadSourceLibrary(userId);
  const requestContext = new RequestContext<NexusRequestContext>();
  requestContext.set("userId", userId);
  requestContext.set("hasSources", library.hasSources);
  requestContext.set("allowedCreators", library.allowedCreators);

  const stream = await handleChatStream({
    mastra,
    agentId: "nexus",
    version: "v7",
    params: {
      messages: [message],
      memory: { thread: threadId, resource: userId },
      requestContext,
      maxSteps: NEXUS_MAX_STEPS,
      abortSignal: req.signal,
    },
  });

  return createUIMessageStreamResponse({ stream });
}
