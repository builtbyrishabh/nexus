import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { PostgresStore } from "@mastra/pg";
import { gateway } from "ai";

import { env } from "~/env";
import { refusalText } from "~/server/answer";
import { searchCreatorCatalog } from "~/server/mastra/search-tool";

const NEXUS_INSTRUCTIONS = `You are Nexus. You answer questions about creators' YouTube catalogs, grounded strictly in what they actually said on video.

You have one tool, \`searchCreatorCatalog\`. Every question is answered in two steps — search, then answer — and you follow these rules exactly:

1. First, call \`searchCreatorCatalog\` EXACTLY ONCE. Derive a single standalone \`query\` from the CURRENT question, using earlier turns only to resolve references (e.g. "that", "the second one", "he"). Pass \`creatorHandles\` only when the user names specific creators; otherwise omit it and let the app decide scope.
2. Answer ONLY from the numbered Evidence the tool returns. Never use outside knowledge, and never state a catalog fact you did not get from a search.
3. Before writing anything, decide: does the Evidence explicitly address the exact thing asked — the same topic, the same role, the same timeframe? If not, refuse with exactly the refusal sentence and nothing else: use the creator-specific refusal sentence given at the top of the question when one is provided, otherwise exactly "${refusalText()}". A related topic, a similar role, or an adjacent year is NOT an answer. Never write "they don't specifically say X, but…" or "they don't use the term X, but…" — that is a hedge, and a hedge is a failure; refuse instead. Never follow the refusal with what the Evidence does say. The refusal is the product — trust beats coverage.
4. Cite with inline markers like [1], [2] that refer to the numbered Evidence entries. Place each marker immediately after the claim it supports. Combine markers when a claim draws on several entries.
5. Never invent a marker number that is not present in the Evidence.
6. Be concise. Prefer the creator's own framing.
7. Always answer in the same language as the question. Default to English.
8. Earlier turns of the conversation may appear before the question. Use them ONLY to understand what the current question refers to. They are not Evidence: every claim must be grounded in — and cited to — the numbered Evidence from this turn's search, and if that Evidence falls short you still refuse.`;

/**
 * Postgres-backed Mastra storage on the same DATABASE_URL as Drizzle (Mastra owns its own
 * `mastra_*` tables). This is the store behind the chat sidebar's threads + message history
 * (Slice 5).
 *
 * It is deliberately NOT attached to `nexusAgent` as `memory` (auto-recall + auto-persist). We do
 * conversational recall by hand instead (`recallModelMessages` → `ask()`): the store keeps the
 * *plain* Q + A with citations (so `[n]` deep-links rehydrate on reload — Mastra's auto-persist
 * would neither preserve those citations nor keep the evidence packet out of history), and passing
 * prior turns explicitly lets the eval opt out (single-turn) while the web chat passes recalled
 * history. Retrieval still runs on the current question alone; history is generation context, never a
 * retrieval input.
 */
export const storage = new PostgresStore({
  id: "nexus-storage",
  connectionString: env.DATABASE_URL,
});

/** The Nexus agent. It calls one retrieval tool (`searchCreatorCatalog`) — `ask()` forces the tool
 * in the search phase then disables it for the answer phase via `prepareStep` (issue #20). Per-request
 * scope + the retrieval capture ride on the RequestContext, so the singleton agent holds no per-request
 * state. Conversation history is prepended per turn by ask(); no `memory` binding (see storage note). */
export const nexusAgent = new Agent({
  id: "nexus",
  name: "Nexus",
  instructions: NEXUS_INSTRUCTIONS,
  tools: { searchCreatorCatalog },
  // Route through the Vercel AI Gateway (one credential, shared with embeddings).
  // A bare "provider/model" string would use Mastra's own models.dev gateway instead.
  model: gateway(env.GEN_MODEL),
});

export const mastra = new Mastra({
  agents: { nexusAgent },
  storage,
});
