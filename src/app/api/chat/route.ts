import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";

import { ask } from "~/server/ask";
import type { NexusUIMessage } from "~/server/domain/ui";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function lastUserText(messages: NexusUIMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

export async function POST(req: Request) {
  const { messages }: { messages: NexusUIMessage[] } = await req.json();
  const query = lastUserText(messages);

  const stream = createUIMessageStream<NexusUIMessage>({
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();
      let textStarted = false;

      for await (const chunk of ask({
        query,
        channel: "web",
        userId: "web:anon",
        threadId: "web:anon",
      })) {
        if (chunk.citations) {
          writer.write({ type: "data-citations", data: chunk.citations });
        }
        if (chunk.sources) {
          writer.write({ type: "data-sources", data: chunk.sources });
        }
        if (chunk.textDelta !== undefined) {
          if (!textStarted) {
            writer.write({ type: "text-start", id: textId });
            textStarted = true;
          }
          writer.write({
            type: "text-delta",
            id: textId,
            delta: chunk.textDelta,
          });
        }
      }

      if (textStarted) writer.write({ type: "text-end", id: textId });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
