import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  catalogSearchResultSchema,
  toCatalogEvidence,
} from "~/server/domain/citations";
import { nexusRequestContextSchema } from "~/server/domain/source-library";
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
  creatorHandle: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The exact handle of one available creator to search. Omit to search the user's full source library.",
    ),
});

/**
 * Search only the authenticated user's source library. Structured results are persisted as native
 * tool output, so the model and citation UI share one source of truth.
 */
export const searchCreatorCatalog = createTool({
  id: "searchCreatorCatalog",
  description:
    "Search the indexed creator catalog for evidence relevant to the user's question.",
  inputSchema,
  outputSchema: catalogSearchResultSchema,
  requestContextSchema: nexusRequestContextSchema,
  execute: async ({ query, creatorHandle }, { requestContext }) => {
    const userId = requestContext.get("userId");
    const hasSources = requestContext.get("hasSources");
    const allowedCreators = requestContext.get("allowedCreators");

    if (!hasSources) {
      return {
        evidence: [],
        message: "Your source library is empty. Add a creator before searching it.",
      };
    }

    if (
      creatorHandle &&
      !allowedCreators.some((creator) => creator.handle === creatorHandle)
    ) {
      return {
        evidence: [],
        message: `The creator '${creatorHandle}' is not in your source library.`,
      };
    }

    const evidence = await retrieve(query, {
      userId,
      ...(creatorHandle ? { creatorHandle } : {}),
      topK: ANSWER_TOP_K,
    });

    return { evidence: evidence.map(toCatalogEvidence) };
  },
});
