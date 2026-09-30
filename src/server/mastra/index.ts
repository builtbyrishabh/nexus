import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { gateway } from "ai";

import { env } from "~/env";
import {
  nexusRequestContextSchema,
  type NexusRequestContext,
} from "~/server/domain/source-library";
import { searchCreatorCatalog } from "~/server/mastra/search-tool";

const NEXUS_INSTRUCTIONS = `You are Nexus. You answer questions about creators' YouTube catalogs, grounded strictly in what they actually said on video.

For every question about what a creator said or taught, use \`searchCreatorCatalog\` before answering. Start with one focused, standalone query. You may search more than once when another focused query would materially improve coverage, resolve ambiguity, or examine the question from a useful second angle. Stop searching once the evidence is sufficient. You can answer greetings and other conversational messages without searching.

For claims about catalog content:
- Answer only from evidence returned by \`searchCreatorCatalog\`; do not fill gaps with outside knowledge.
- Cite each supported claim inline as [cite:<citationId>]. Copy the complete citationId from the evidence character-for-character; never shorten, combine, or invent IDs.
- If the evidence does not support the requested claim, say that the catalog does not provide enough evidence and suggest a useful next question.

Answering style:
- Lead with the direct answer. Keep ordinary answers under 150 words and in one to three short paragraphs.
- Do not use headings, numbered steps, or bullets unless the user explicitly asks for a list or step-by-step answer.
- Synthesize the evidence into one coherent response instead of walking through retrieved passages one by one.
- Attribute a creator only when the evidence supplies a non-null author. Never infer identity from the user's wording or a video title. Use the trusted author and video title naturally when they help orient the user, without repeating them for every citation.
- When asked for a creator's point of view, explain only what their cited evidence supports. Never imitate the creator or write in their voice.
- Do not end with a generic offer to answer another question.
- Do not mention searches, chunks, retrieved context, or other internal mechanics.

Prefer the creator's own framing and answer in the same language as the user. Default to English.`;

function creatorInstructions(
  allowedCreators: { handle: string; displayName: string }[],
  hasSources: boolean,
): string {
  if (!hasSources) {
    return "This user's source library is empty. If catalog evidence is requested, explain that they need to add a creator first.";
  }
  if (allowedCreators.length === 0) {
    return "This user's source library has sources but no named creators. Search the full library without a creator handle.";
  }

  const roster = allowedCreators
    .map((creator) => `- ${creator.displayName}: ${creator.handle}`)
    .join("\n");
  return `The creators available in this user's source library are:\n${roster}\n\nWhen the user asks for one creator's perspective, pass that creator's exact handle to searchCreatorCatalog. Never target a creator outside this list. A creator perspective means evidence from their videos, never imitation of their voice. If the tool returns a message instead of evidence, relay it plainly.`;
}

export const NEXUS_MAX_STEPS = 30;

/**
 * Postgres-backed Mastra storage on the same DATABASE_URL as Drizzle (Mastra owns its own
 * `mastra_*` tables). It backs both the agent's native memory and the thread sidebar.
 */
export const storage = new PostgresStore({
  id: "nexus-storage",
  connectionString: env.DATABASE_URL,
});

const model = gateway(env.GEN_MODEL);

// Titles are seeded deterministically from the first question when the thread is
// created (see `createThread` in `~/server/chat/threads`), so we leave Mastra's
// LLM `generateTitle` off — it costs a model call per thread and would overwrite
// the question snippet the sidebar shows.
/** One native memory instance owns thread persistence and recall. */
export const nexusMemory = new Memory({
  storage,
  options: {
    lastMessages: 20,
  },
});

/** The registered agent owns its prompt, memory, model, and retrieval tool. */
export const nexusAgent = new Agent<
  "nexus",
  { searchCreatorCatalog: typeof searchCreatorCatalog },
  undefined,
  NexusRequestContext
>({
  id: "nexus",
  name: "Nexus",
  requestContextSchema: nexusRequestContextSchema,
  instructions: ({ requestContext }) => {
    const allowedCreators = requestContext.get("allowedCreators") ?? [];
    const hasSources = requestContext.get("hasSources") ?? false;
    return `${NEXUS_INSTRUCTIONS}\n\n${creatorInstructions(allowedCreators, hasSources)}`;
  },
  tools: { searchCreatorCatalog },
  memory: nexusMemory,
  // Route through the Vercel AI Gateway (one credential, shared with embeddings).
  // A bare "provider/model" string would use Mastra's own models.dev gateway instead.
  model,
});

export const mastra = new Mastra({
  agents: { nexusAgent },
  storage,
});
