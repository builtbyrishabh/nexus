import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  catalogSearchResultSchema,
  toCatalogEvidence,
} from "~/server/domain/citations";
import { retrieve } from "~/server/retrieval/retrieve";

/** How much evidence one answer reads. The one retrieval knob, shared across every caller. */
export const ANSWER_TOP_K = 5;

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "A standalone semantic search query for the indexed creator catalog.",
    ),
});

/**
 * Search the full indexed catalog with the production retrieval settings. Structured results are
 * persisted as native tool output, so the model and citation UI share one source of truth.
 */
export const searchCreatorCatalog = createTool({
  id: "searchCreatorCatalog",
  description:
    "Search the indexed creator catalog for evidence relevant to the user's question.",
  inputSchema,
  outputSchema: catalogSearchResultSchema,
  execute: async ({ query }) => {
    const evidence = await retrieve(query, {
      topK: ANSWER_TOP_K,
    });

    return { evidence: evidence.map(toCatalogEvidence) };
  },
});
