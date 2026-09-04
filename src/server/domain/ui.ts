import type { UIMessage } from "ai";

import type { Citation, SourceCard } from "~/server/domain/types";

/**
 * The wire message type shared by the chat route and the web client. Citations and source
 * cards travel as typed data parts alongside the streamed text.
 */
export type NexusUIMessage = UIMessage<
  never, // metadata
  {
    citations: Citation[];
    sources: SourceCard[];
  }
>;
