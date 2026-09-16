import { RequestContext } from "@mastra/core/request-context";
import type { ModelMessage } from "ai";

import { refusalText } from "~/server/answer";
import { evidenceToCitations } from "~/server/domain/citations";
import type { Ask, AskChunk } from "~/server/domain/types";
import { nexusAgent } from "~/server/mastra";
import type { SearchCapture } from "~/server/mastra/search-tool";

/** Keep the model's cross-turn context bounded — the last few turns resolve references; older ones don't. */
const MAX_HISTORY_MESSAGES = 10;
/** Two model steps: one to search, one to answer. The tool guards the single retrieval execution. */
const MAX_STEPS = 2;

/**
 * A scoped run of the agentic query path, ready for either finish: `ask()` streams it,
 * the eval blocks with `generate`. Both build it here so they exercise the SAME orchestration —
 * same agent, same tool, same phase control, same scope on the RequestContext — and the eval grades
 * exactly what ships. `capture` is the shared handle the tool fills and the caller reads back.
 */
export type ScopedRun = {
  messages: ModelMessage[];
  capture: SearchCapture;
  options: {
    requestContext: RequestContext;
    maxSteps: number;
    prepareStep: (args: { stepNumber: number }) => {
      toolChoice: "required" | "none";
      activeTools: string[];
    };
    abortSignal: AbortSignal;
  };
  controller: AbortController;
};

/** Look up a handle's display name from the request-resolved map, falling back to the raw handle. */
function nameOf(names: Record<string, string> | undefined, handle: string): string {
  return names?.[handle] ?? handle;
}

/** The creator this scope refuses as: a single effective creator → their name, else neutral. */
function effectiveCreatorName(
  capture: SearchCapture,
  names?: Record<string, string>,
): string | undefined {
  const handle =
    capture.effectiveHandles?.length === 1 ? capture.effectiveHandles[0] : undefined;
  return handle ? nameOf(names, handle) : undefined;
}

/** The honest clarification when the agent chose creators outside the collection. */
function invalidScopeText(handles: string[], names?: Record<string, string>): string {
  const label = handles.map((h) => nameOf(names, h)).join(", ");
  return `I don't have ${label} in this collection, so I can't answer that.`;
}

/**
 * The final answer text, decided by the APPLICATION, not the model, for every non-answer branch so
 * the outcomes stay distinct and honest: an `ok` turn streams the model's grounded answer; empty
 * evidence / empty collection refuse (per-creator when scoped to one, else neutral); an invalid
 * scope clarifies. A provider failure never reaches here — it throws out of the tool.
 */
export function finalizeText(
  capture: SearchCapture,
  modelText: string,
  names?: Record<string, string>,
): string {
  switch (capture.outcome) {
    case "ok":
      return modelText;
    case "invalid_scope":
      return invalidScopeText(capture.invalidHandles ?? [], names);
    default:
      return refusalText(effectiveCreatorName(capture, names));
  }
}

/**
 * Force the search tool in step 0, then take it away for the answer step. Belt-and-braces with the
 * tool's own one-execution guard: even if a step batches parallel calls, the second no-ops, and the
 * answer step has no tool to call, so a catalog fact can never appear without a search behind it.
 */
function searchThenAnswer({ stepNumber }: { stepNumber: number }): {
  toolChoice: "required" | "none";
  activeTools: string[];
} {
  return stepNumber === 0
    ? { toolChoice: "required", activeTools: ["searchCreatorCatalog"] }
    : { toolChoice: "none", activeTools: [] };
}

/**
 * When the user fixed a single creator (a Panel column), lead the turn with a directive naming them
 * and their exact refusal sentence, so a model refusal is that creator's — mirroring the deterministic
 * refusal the app emits for empty evidence. Unscoped / whole-collection turns get no directive and the
 * neutral refusal voice. We never infer a pronoun from a name (see `refusalText`).
 */
function currentTurn(input: Ask): ModelMessage {
  const handle =
    input.selectedCreatorHandles?.length === 1
      ? input.selectedCreatorHandles[0]
      : undefined;
  const name = handle ? nameOf(input.creatorNames, handle) : undefined;
  const directive = name
    ? `You are answering about ${name}'s YouTube catalog. If the catalog does not address the exact thing asked, reply with exactly "${refusalText(name)}" and nothing else.\n\n`
    : "";
  return { role: "user", content: `${directive}${input.query}` };
}

/**
 * Assemble a scoped run: bounded history + the current turn as messages, server-owned scope + the
 * retrieval capture on the RequestContext, and the phase controls. `rerank` is left unset on the
 * product path (the tool defaults to strict), and set by the eval to A/B the reranker.
 */
export function buildScopedRun(input: Ask & { rerank?: boolean }): ScopedRun {
  const capture: SearchCapture = { executed: false };

  const requestContext = new RequestContext();
  requestContext.setRaw("collectionCreatorHandles", input.collectionCreatorHandles);
  if (input.selectedCreatorHandles) {
    requestContext.setRaw("selectedCreatorHandles", input.selectedCreatorHandles);
  }
  requestContext.setRaw("capture", capture);
  if (input.rerank !== undefined) requestContext.setRaw("rerank", input.rerank);

  const history = (input.history ?? []).slice(-MAX_HISTORY_MESSAGES);
  const messages: ModelMessage[] = [...history, currentTurn(input)];

  const controller = new AbortController();
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  return {
    messages,
    capture,
    controller,
    options: {
      requestContext,
      maxSteps: MAX_STEPS,
      prepareStep: searchThenAnswer,
      abortSignal: controller.signal,
    },
  };
}

/**
 * The one entrypoint every surface calls. The agent searches once (the `searchCreatorCatalog` tool),
 * then answers grounded + cited — or the application returns the honest non-answer.
 *
 * Streaming contract, unchanged from the caller's view: citations are emitted BEFORE any answer
 * text. We read them off the tool result (the exact Evidence the model was shown, numbered the
 * same), so `[n]` deep-links line up. Planning text can never leak as the answer: text is forwarded
 * only after an `ok` search. A non-ok outcome emits the deterministic text and stops; a tool/provider
 * error throws (operational), never a silent refusal.
 */
export async function* ask(input: Ask): AsyncGenerator<AskChunk> {
  const { messages, capture, options, controller } = buildScopedRun(input);
  const out = await nexusAgent.stream(messages, options);

  let answering = false;
  let citationsEmitted = false;

  for await (const chunk of out.fullStream) {
    if (chunk.type === "tool-error") {
      const { error } = chunk.payload;
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (
      chunk.type === "tool-result" &&
      chunk.payload.toolName === "searchCreatorCatalog"
    ) {
      yield { citations: evidenceToCitations(capture.evidence ?? []) };
      citationsEmitted = true;

      if (capture.outcome !== "ok") {
        yield { textDelta: finalizeText(capture, "", input.creatorNames) };
        controller.abort(); // no answer step needed — stop the model call.
        return;
      }
      answering = true;
      continue;
    }

    if (chunk.type === "text-delta" && answering) {
      yield { textDelta: chunk.payload.text };
    }
  }

  // Defensive: the model somehow answered without searching (impossible under toolChoice "required").
  // Never let that become an uncited factual answer.
  if (!citationsEmitted) {
    yield { citations: [] };
    yield { textDelta: refusalText() };
  }
}
