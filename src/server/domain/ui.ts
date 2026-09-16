import type { UIMessage } from "ai";

import type { Citation } from "~/server/domain/types";

/**
 * The wire message type shared by the chat route and the web client. Citations travel as a typed
 * data part alongside the streamed text.
 */
export type NexusUIMessage = UIMessage<
  never, // metadata
  {
    citations: Citation[];
  }
>;
