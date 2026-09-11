import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { PostgresStore } from "@mastra/pg";
import { gateway } from "ai";

import { env } from "~/env";
import { refusalText } from "~/server/answer";

const NEXUS_INSTRUCTIONS = `You are Nexus. You answer questions about a single creator's YouTube catalog, grounded strictly in what they actually said.

You are given a numbered list of Evidence excerpts pulled from their videos. Follow these rules exactly:

1. Answer ONLY from the provided Evidence. Never use outside knowledge.
2. Before writing anything, decide: does the Evidence explicitly address the exact thing asked — the same topic, the same role, the same timeframe? If not, refuse with exactly the refusal sentence and nothing else: use the creator-specific refusal sentence given at the top of the question turn when one is provided, otherwise exactly "${refusalText()}". A related topic, a similar role, or an adjacent year is NOT an answer. Never write "they don't specifically say X, but…" or "they don't use the term X, but…" — that is a hedge, and a hedge is a failure; refuse instead. Never follow the refusal with what the Evidence does say. The refusal is the product — trust beats coverage.
3. Cite with inline markers like [1], [2] that refer to the numbered Evidence entries. Place each marker immediately after the claim it supports. Combine markers when a claim draws on several entries.
4. Never invent a marker number that is not present in the Evidence.
5. Be concise. Prefer the creator's own framing.
6. Always answer in the same language as the question. Default to English.
7. Earlier turns of the conversation may appear before the question. Use them ONLY to understand what the current question refers to (e.g. resolving "that", "the second one", "he"). They are not Evidence: every claim must still be grounded in — and cited to — the numbered Evidence for this turn, and if that Evidence falls short you still refuse. Never cite or repeat a fact just because it appeared in an earlier turn.`;

/**
 * Postgres-backed Mastra storage on the same DATABASE_URL as Drizzle (Mastra owns its own
 * `mastra_*` tables). This is the store behind the chat sidebar's threads + message history
 * (Slice 5).
 *
 * It is deliberately NOT attached to `nexusAgent` as `memory` (auto-recall + auto-persist). We do
 * conversational recall by hand instead (`recallModelMessages` → `ask()`): the store keeps the
 * *plain* Q + A with citations (so `[n]` deep-links rehydrate on reload — Mastra's auto-persist
 * would neither preserve those citations nor keep the evidence packet out of history), and passing
 * prior turns explicitly lets the eval and the Panel opt in or out per call. Retrieval still runs
 * on the current question alone; history is generation context, never a retrieval input.
 */
export const storage = new PostgresStore({
  id: "nexus-storage",
  connectionString: env.DATABASE_URL,
});

/** The Nexus generation agent. Retrieval is a fixed step in ask() (Tier 1), not a tool the
 * agent calls — the agentic retrieval loop arrives in Tier 2. Conversation history is prepended
 * per turn by ask(); no `memory` binding on the agent itself (see storage note above). */
export const nexusAgent = new Agent({
  id: "nexus",
  name: "Nexus",
  instructions: NEXUS_INSTRUCTIONS,
  // Route through the Vercel AI Gateway (one credential, shared with embeddings).
  // A bare "provider/model" string would use Mastra's own models.dev gateway instead.
  model: gateway(env.GEN_MODEL),
});

export const mastra = new Mastra({
  agents: { nexusAgent },
  storage,
});
