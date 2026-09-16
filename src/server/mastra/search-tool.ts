import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { buildEvidencePacket } from "~/server/domain/citations";
import { resolveScope } from "~/server/domain/scope";
import type { Evidence } from "~/server/domain/types";
import { retrieve } from "~/server/retrieval/retrieve";

/** How much evidence one answer reads. The one retrieval knob, shared across every caller. */
export const ANSWER_TOP_K = 5;
/** Cap the model-authored search query so a runaway query can't blow up the request. */
const MAX_QUERY_LEN = 500;

/** How the tool's single retrieval resolved — read back by the caller to pick the final text. */
export type SearchOutcome =
  | "ok"
  | "empty_evidence"
  | "empty_collection"
  | "invalid_scope";

/**
 * Per-request scratchpad the tool fills and the caller (`ask()` / the eval) reads back. It rides on
 * the `RequestContext` — the tool is registered on the singleton agent, so it can hold no per-request
 * state of its own. This is what lets the application, not the model, decide the final text for the
 * non-answer branches (honest, distinct outcomes) and build citations from the exact Evidence shown.
 */
export type SearchCapture = {
  /** One retrieval per turn: set on the first call so a second (parallel) call no-ops. */
  executed: boolean;
  outcome?: SearchOutcome;
  /** The Evidence the model was shown (numbered), or `[]` for every non-ok outcome. */
  evidence?: Evidence[];
  /** The effective creator scope actually searched — drives per-creator vs neutral refusal wording. */
  effectiveHandles?: string[];
  /** Out-of-collection handles the agent chose (only for `invalid_scope`). */
  invalidHandles?: string[];
};

/** Read the request-scoped capture off the (open-map) RequestContext. */
function captureOf(requestContext: { getRaw(key: string): unknown }): SearchCapture {
  return requestContext.getRaw("capture") as SearchCapture;
}

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "A standalone search query for the creators' video catalog. Derive it from the CURRENT " +
        "question, using earlier turns only to resolve references (e.g. 'that', 'the second one', 'he').",
    ),
  creatorHandles: z
    .array(z.string())
    .optional()
    .describe(
      "Optional: narrow the search to specific creators the user named. Omit to let the app decide " +
        "scope (a fixed user selection, or the whole collection).",
    ),
});

/**
 * The one retrieval tool the agent calls. It wraps the existing `retrieve()` pipeline (dense +
 * full-text → RRF → rerank → neighbors) behind the issue #20 scope contract:
 *
 *   - Server-owned scope (`collectionCreatorHandles`, `selectedCreatorHandles`) comes off the
 *     RequestContext; the model only supplies `query` + an optional `creatorHandles` narrowing.
 *     `resolveScope` decides the effective set (selection > agent choice > whole collection).
 *   - Strict rerank (`rerank: true`) so a provider failure THROWS (an operational error) instead of
 *     silently dropping past the calibrated relevance floor and looking like "never covered".
 *   - Every non-ok outcome (empty collection, invalid scope, empty evidence) records itself in the
 *     capture and returns a short instruction; the application turns that into the honest response.
 *
 * The returned string is the numbered Evidence packet the model cites against — the SAME numbering
 * `evidenceToCitations` gives the client, so marker [n] ↔ evidence n ↔ citation n-1.
 */
export const searchCreatorCatalog = createTool({
  id: "searchCreatorCatalog",
  description:
    "Search the indexed creator video catalog for evidence to answer the user's question. Call this " +
    "exactly once per turn before answering; answer only from what it returns.",
  inputSchema,
  execute: async ({ query, creatorHandles }, { requestContext }) => {
    const capture = captureOf(requestContext);

    // One retrieval execution per turn — even if a single model step emits parallel tool calls.
    if (capture.executed) {
      return "A search has already run this turn. Answer from the Evidence already provided; do not search again.";
    }
    capture.executed = true;

    const collection =
      (requestContext.getRaw("collectionCreatorHandles") as string[] | undefined) ?? [];
    const selected = requestContext.getRaw("selectedCreatorHandles") as
      | string[]
      | undefined;

    const scope = resolveScope({ collection, selected, agentChoice: creatorHandles });
    if (scope.kind === "empty_collection") {
      capture.outcome = "empty_collection";
      capture.evidence = [];
      return "No creators are in scope for this request. Reply with exactly the refusal sentence and nothing else.";
    }
    if (scope.kind === "invalid_scope") {
      capture.outcome = "invalid_scope";
      capture.evidence = [];
      capture.invalidHandles = scope.bad;
      return `Those creators are not in this collection: ${scope.bad.join(", ")}. Do not answer; a clarification is returned to the user.`;
    }

    capture.effectiveHandles = scope.handles;

    // A provider failure here throws → surfaces as an operational error upstream, never a refusal.
    const rerank = (requestContext.getRaw("rerank") as boolean | undefined) ?? true;
    const evidence = await retrieve(query.slice(0, MAX_QUERY_LEN), {
      topK: ANSWER_TOP_K,
      rerank,
      filter: { creatorHandles: scope.handles },
    });

    if (evidence.length === 0) {
      capture.outcome = "empty_evidence";
      capture.evidence = [];
      return "No Evidence was found in the indexed videos for this query. Reply with exactly the refusal sentence and nothing else.";
    }

    capture.outcome = "ok";
    capture.evidence = evidence;
    return `Evidence:\n\n${buildEvidencePacket(evidence)}`;
  },
});
