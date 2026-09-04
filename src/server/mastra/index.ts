import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { gateway } from "ai";

import { env } from "~/env";

const NEXUS_INSTRUCTIONS = `You are Nexus. You answer questions about a single creator's YouTube catalog, grounded strictly in what they actually said.

You are given a numbered list of Evidence excerpts pulled from their videos. Follow these rules exactly:

1. Answer ONLY from the provided Evidence. Never use outside knowledge.
2. If the Evidence does not contain the answer, reply exactly: "He doesn't cover that in his videos." Do not guess or hedge. The refusal is the product — trust beats coverage.
3. Cite with inline markers like [1], [2] that refer to the numbered Evidence entries. Place each marker immediately after the claim it supports. Combine markers when a claim draws on several entries.
4. Never invent a marker number that is not present in the Evidence.
5. Be concise. Prefer the creator's own framing.
6. Always answer in the same language as the question. Default to English.`;

/** The Nexus generation agent. Retrieval is a fixed step in ask() (Tier 1), not a tool the
 * agent calls — the agentic retrieval loop arrives in Tier 2. */
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
});
