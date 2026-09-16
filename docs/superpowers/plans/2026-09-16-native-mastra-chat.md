# Native Mastra Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Nexus's custom chat orchestration with Mastra's native agent, memory, tool-loop, and AI SDK stream path while keeping timestamp citations and strict catalog retrieval.

**Architecture:** The browser sends the newest `UIMessage` and a thread ID to one authenticated route. The route checks thread ownership and delegates the turn to Mastra's `handleChatStream`; the registered Nexus agent owns its prompt, native `Memory`, and a structured catalog-search tool. Search results carry stable chunk IDs, and the React client rebuilds a citation registry from persisted tool outputs so inline timestamp links work during streaming and after reload.

**Tech Stack:** Next.js App Router, React, TypeScript, Mastra, `@mastra/memory`, AI SDK v7, Zod, Vitest, PostgreSQL/pgvector, tRPC

**Spec:** `docs/superpowers/specs/2026-09-16-native-mastra-chat-design.md`

## Global Constraints

- Prefer the native Mastra and AI SDK path even where it changes existing behavior.
- Keep only one production retrieval mode: full-catalog hybrid retrieval with strict reranking.
- Let the agent decide whether and how often to call search, up to 30 steps.
- Put missing-evidence behavior in the system prompt; do not enforce an exact refusal string in application code.
- Load all thread messages for now with `lastMessages: Number.MAX_SAFE_INTEGER`; do not add a replacement message cap.
- Preserve citations as `[cite:<chunk-id>]` markers backed by structured tool output.
- Do not migrate or preserve compatibility with messages saved by the old custom stream.
- Delete custom orchestration once the native path has replaced it; do not leave parallel implementations.

---

### Task 1: Make catalog search return structured, stable evidence

**Files:**
- Modify: `src/server/domain/citations.ts`
- Modify: `src/server/mastra/search-tool.ts`
- Create: `src/server/mastra/search-tool.test.ts`
- Modify: `src/server/domain/types.ts`

**Interfaces:**
- Consumes: `Evidence` from `src/server/domain/types.ts` and `retrieve(query, options)` from `src/server/retrieval/retrieve.ts`.
- Produces: `CatalogEvidence`, `CatalogSearchResult`, `catalogSearchResultSchema`, `toCatalogEvidence(evidence)`, and `searchCreatorCatalog` with input `{ query: string }`.

- [x] **Step 1: Write the failing structured-result tests**

Add tests that mock `retrieve` and execute `searchCreatorCatalog` directly. Prove these behaviors:

1. The tool accepts only `{ query }`.
2. Queries longer than 500 characters are rejected by the tool schema; valid queries reach retrieval unchanged.
3. Retrieval is always called with `topK: 5`, with strict reranking built into the one production retrieval path and no creator filter.
4. The output is an object with an `evidence` array rather than a formatted prompt string.
5. Each result uses the chunk ID as `citationId` and includes the display fields needed by the client.

Use a representative video result and a non-video result so timestamp and URL behavior are both covered:

```ts
expect(result).toEqual({
  evidence: [
    {
      citationId: "chunk-1",
      text: "Creator Name: ...",
      title: "Example video",
      url: "https://youtube.com/watch?v=abc&t=65s",
      startSec: 65,
      timestamp: "1:05",
    },
  ],
});
```

Run:

```bash
pnpm vitest run src/server/mastra/search-tool.test.ts
```

Expected: FAIL because the current tool accepts `creatorHandles`, reads request-scoped state, and returns a string.

- [x] **Step 2: Define the shared search-result boundary**

In `src/server/domain/citations.ts`, replace numbered-packet helpers with a small Zod-backed contract:

```ts
export const catalogEvidenceSchema = z.object({
  citationId: z.string().min(1),
  text: z.string(),
  title: z.string(),
  url: z.string().url(),
  startSec: z.number().nonnegative().optional(),
  timestamp: z.string().optional(),
});

export const catalogSearchResultSchema = z.object({
  evidence: z.array(catalogEvidenceSchema),
});

export type CatalogEvidence = z.infer<typeof catalogEvidenceSchema>;
export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;
```

Keep `formatTimestamp`, `buildDeepLink`, and `evidenceText`. Add one conversion function from the retrieval domain's `Evidence` type to `CatalogEvidence`. It must set `citationId` from `Evidence.chunkId` and produce the final deep link once, at the tool boundary.

Remove `Citation` from `src/server/domain/types.ts`; the structured tool result becomes the single citation source of truth.

- [x] **Step 3: Simplify the production tool**

Change `searchCreatorCatalog` so its input schema is exactly:

```ts
z.object({ query: z.string().min(1).max(500) })
```

Its executor should make one direct retrieval call:

```ts
const evidence = await retrieve(query, {
  topK: ANSWER_TOP_K,
});

return {
  evidence: evidence.map(toCatalogEvidence),
};
```

Remove `SearchCapture`, `SearchOutcome`, `RequestContext`, creator-name lookup, scope resolution, and evidence-packet formatting from this file.

- [x] **Step 4: Run the focused test**

Run:

```bash
pnpm vitest run src/server/mastra/search-tool.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/server/domain/citations.ts src/server/domain/types.ts src/server/mastra/search-tool.ts src/server/mastra/search-tool.test.ts
git commit -m "refactor(chat): return structured search evidence"
```

### Task 2: Give the registered Mastra agent native memory and a simple prompt

**Files:**
- Modify: `src/server/mastra/index.ts`
- Create: `src/server/mastra/index.test.ts`

**Interfaces:**
- Consumes: structured `searchCreatorCatalog` from Task 1, `PostgresStore`, `Memory`, and the configured AI Gateway model.
- Produces: `nexusMemory: Memory`, `nexusAgent: Agent`, `mastra: Mastra`, and `NEXUS_MAX_STEPS = 30`.

- [x] **Step 1: Configure one model, one memory, and one registered agent**

Create the gateway model once and reuse it for the agent and native title generation. Export the memory instance so thread procedures use the same configured store:

```ts
const model = gateway(env.GEN_MODEL);

export const nexusMemory = new Memory({
  storage,
  options: {
    lastMessages: Number.MAX_SAFE_INTEGER,
    generateTitle: {
      model,
      instructions: "Write a short, specific title for this conversation.",
    },
  },
});
```

Configure `nexusAgent` with `memory: nexusMemory`, the existing structured tool, and a concise system prompt. The prompt must state:

- Nexus answers questions about the ingested creator catalog.
- Search is available when catalog evidence is needed; it is optional and repeatable.
- Claims about catalog content must be grounded in search evidence.
- Evidence is cited inline as `[cite:<citationId>]` immediately after the supported claim.
- If the catalog evidence cannot support an answer, say so plainly and suggest a useful next question.

Remove the exact refusal text, mandatory single-tool-call rule, numbered citation syntax, creator-scope instructions, and any prompt rules implemented only for the old two-step pipeline.

Export a single shared constant:

```ts
export const NEXUS_MAX_STEPS = 30;
```

The route and eval runner will both consume it.

- [x] **Step 2: Check the agent module through its focused imports**

Run the focused agent/search tests:

```bash
pnpm vitest run src/server/mastra/search-tool.test.ts
```

Expected: PASS. The full type-check follows Task 6, once the cross-cutting replacement has removed every legacy caller; do not add compatibility exports just to make an intermediate commit compile.

- [x] **Step 3: Commit**

```bash
git add src/server/mastra/index.ts
git commit -m "refactor(chat): use native Mastra memory"
```

### Task 3: Replace route orchestration with `handleChatStream`

**Files:**
- Modify: `src/app/api/chat/request.ts`
- Modify: `src/app/api/chat/request.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/server/chat/threads.ts`
- Create: `src/server/chat/threads.test.ts`
- Create: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: `mastra`, `nexusMemory`, and `NEXUS_MAX_STEPS` from Task 2; Clerk's authenticated `userId`; AI SDK v7 `UIMessage`.
- Produces: `parseChatRequest(input): Promise<{ threadId: string; message: UIMessage }>`, `assertThreadOwner(threadId, userId)`, native thread loading, and the POST streaming route.

- [x] **Step 1: Write the failing request-boundary tests**

Update request tests to require a UUID thread ID and preserve the complete latest user `UIMessage`, including its ID and text part. Add rejection cases for:

- a missing or invalid thread ID;
- an assistant message;
- a user message without any text content;
- malformed UI-message parts.

The parser should return:

```ts
{
  threadId: string;
  message: UIMessage;
}
```

It must not flatten the message to a `query` string.

Run:

```bash
pnpm vitest run src/app/api/chat/request.test.ts
```

Expected: FAIL because the current parser returns `{ query, threadId, userMessageId }`.

- [x] **Step 2: Parse the transport envelope and native message**

Use Zod for the outer request envelope and AI SDK `safeValidateUIMessages` for the contained message. Validate exactly one latest message, require `role === "user"`, and require at least one non-empty text part. Keep the validated `UIMessage` intact.

Do not reconstruct a `ModelMessage` or create a second chat request DTO.

- [x] **Step 3: Reduce thread helpers to native memory CRUD**

In `src/server/chat/threads.ts`:

- Import `nexusMemory` from the Mastra module rather than constructing another `Memory`.
- Keep list, load, rename, delete, and ownership checks.
- Rename/export the ownership helper as `assertThreadOwner(threadId, userId)` so the route can call it.
- Load messages with the native store and convert them through `toAISdkMessages(..., { version: "v7" })`.
- Delete `recallModelMessages`, `persistTurn`, `titleFromQuestion`, and all manual assistant/tool-part serialization.

- [x] **Step 4: Write the failing route-delegation test**

Mock Clerk auth, `assertThreadOwner`, `handleChatStream`, and `createUIMessageStreamResponse`. Assert that an authenticated POST:

1. checks ownership before agent execution;
2. passes only the newest message;
3. passes `{ thread, resource }` native memory identifiers;
4. passes `maxSteps: NEXUS_MAX_STEPS` and `abortSignal: request.signal`;
5. selects the registered `nexus` agent and AI SDK stream version `v7`.

Also verify unauthenticated requests return 401 and never call the agent.

Run:

```bash
pnpm vitest run src/app/api/chat/route.test.ts
```

Expected: FAIL because the current route owns a manual stream, search capture, history recall, and persistence.

- [x] **Step 5: Implement the thin native route**

The route should contain only these responsibilities:

1. Authenticate with Clerk.
2. Parse the request.
3. Assert ownership for an existing thread; allow a missing thread so native memory can create it for the authenticated resource.
4. Call Mastra `handleChatStream` with the registered agent.
5. Wrap the returned stream with `createUIMessageStreamResponse`.

Use this parameter shape:

```ts
const stream = await handleChatStream<UIMessage>({
  mastra,
  agentId: "nexus",
  version: "v7",
  params: {
    messages: [message],
    memory: { thread: threadId, resource: userId },
    maxSteps: NEXUS_MAX_STEPS,
    abortSignal: request.signal,
  },
});
```

Use Mastra/AI SDK's stream error behavior. Keep one route-level log and generic public error for failures before streaming begins. Do not recreate tool-result events, persistence callbacks, retry loops, or custom error taxonomies.

- [x] **Step 6: Run the focused tests**

Run:

```bash
pnpm vitest run src/app/api/chat/request.test.ts src/app/api/chat/route.test.ts
```

Expected: PASS. Defer the repository-wide type-check until Task 6 removes legacy callers of the old tool contract.

- [x] **Step 7: Commit**

```bash
git add src/app/api/chat/request.ts src/app/api/chat/request.test.ts src/app/api/chat/route.ts src/app/api/chat/route.test.ts src/server/chat/threads.ts
git commit -m "refactor(chat): delegate streaming to Mastra"
```

### Task 4: Render citations from native tool parts

**Files:**
- Delete: `src/server/domain/ui.ts`
- Modify: `src/app/_components/answer.tsx`
- Create: `src/app/_components/answer.test.ts`
- Modify: `src/app/_components/chat-conversation.tsx`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `CatalogEvidence` and `catalogSearchResultSchema` from Task 1 plus AI SDK v7 message parts persisted by Task 3.
- Produces: `citationRegistry(messages): ReadonlyMap<string, CatalogEvidence>` and `AnswerText` rendering `[cite:<citationId>]` markers.

- [x] **Step 1: Write failing citation-registry tests**

Add focused tests for pure helpers in `answer.tsx`:

1. `citationRegistry(messages)` finds `output-available` parts for `searchCreatorCatalog` across every assistant message.
2. It validates tool output with `catalogSearchResultSchema` and ignores malformed output.
3. A repeated `citationId` resolves consistently to one citation record.
4. `AnswerText` turns `[cite:chunk-1]` into a link whose visible label is the timestamp and whose href is the stored deep link.
5. Missing citation IDs render as plain marker text so a model mistake is visible rather than silently linked to the wrong source.
6. Normal prose still renders correctly.

Run:

```bash
pnpm vitest run src/app/_components/answer.test.ts
```

Expected: FAIL because the current UI consumes custom `data-citations` parts and numbered `[1]` markers.

- [x] **Step 2: Represent the native UI message**

Delete `src/server/domain/ui.ts` and import AI SDK's `UIMessage` directly wherever the app needs the native message type:

```ts
import type { UIMessage } from "ai";
```

Do not introduce a duplicate hand-maintained union for every AI SDK part state.

- [x] **Step 3: Build one registry for the conversation**

Replace `citationsOf(message)` with:

```ts
export function citationRegistry(
  messages: UIMessage[],
): ReadonlyMap<string, CatalogEvidence>
```

Walk native tool parts, select the catalog-search tool, parse completed outputs, and index each evidence item by `citationId`.

In `chat-conversation.tsx`, compute this registry once with `useMemo` for the current message list and pass it to every assistant `AnswerText`. This lets later answers cite evidence returned in an earlier turn and makes the same code work after thread reload.

- [x] **Step 4: Render stable citation markers**

Change the inline marker parser from numbered references to `[cite:<id>]`. Resolve the ID through the registry and render the link label as `timestamp` when present, falling back to a short source label for non-video evidence.

Keep the existing prose rendering for all non-citation text.

- [x] **Step 5: Run the focused tests**

Run:

```bash
pnpm vitest run src/app/_components/answer.test.ts
```

Expected: PASS. Defer the repository-wide type-check until Task 6 removes legacy eval and orchestration imports.

- [x] **Step 6: Commit**

```bash
git add vitest.config.ts src/server/domain/ui.ts src/app/_components/answer.tsx src/app/_components/answer.test.ts src/app/_components/chat-conversation.tsx
git commit -m "refactor(chat): render citations from tool output"
```

### Task 5: Make evals exercise the production agent path

**Files:**
- Modify: `src/server/evals/golden.ts`
- Modify: `src/server/evals/run.ts`
- Create: `src/server/evals/run.test.ts`
- Modify: `src/server/evals/score.ts`
- Modify: `src/server/evals/score.test.ts`
- Modify: `src/server/evals/summary.ts`
- Modify: `src/server/evals/summary.test.ts`
- Modify: `scripts/eval.ts`

**Interfaces:**
- Consumes: `nexusAgent`, `NEXUS_MAX_STEPS`, `CatalogEvidence`, and the existing Mastra faithfulness/relevancy/precision scorers.
- Produces: `runEvalSuite` over the production agent path and semantic unsupported-answer grading without an exact refusal string.

- [x] **Step 1: Write failing tests for semantic missing-evidence grading**

Add a unit test around the grading boundary in `score.ts`. Mock the judge model and prove the grader accepts paraphrased unsupported-answer responses instead of requiring one exact sentence. Include a negative case where the answer invents catalog facts despite empty evidence.

Keep the result field named `refused` if that avoids a broad reporting rename, but document it as a semantic judgment: the answer appropriately declined to make an unsupported catalog claim.

Run:

```bash
pnpm vitest run src/server/evals/score.test.ts src/server/evals/summary.test.ts
```

Expected: FAIL because refusal detection currently depends on the deleted exact refusal string.

- [x] **Step 2: Grade behavior semantically**

Use the existing judge model with a small structured output schema:

```ts
z.object({
  declinedUnsupportedClaim: z.boolean(),
})
```

The judge prompt receives the user question, answer, and retrieved evidence. It should return true only when the response clearly says the catalog lacks enough support and does not fill the gap with ungrounded facts.

Keep existing faithfulness, answer-relevancy, and context-precision scorers. Do not add another scoring framework.

- [x] **Step 3: Run the registered agent directly**

Rewrite `run.ts` so each golden case calls `nexusAgent.generate` with `maxSteps: NEXUS_MAX_STEPS`. Collect catalog evidence from the completed `searchCreatorCatalog` tool results in the generated steps and feed that evidence to the existing scorers.

For cases with history, prepend those messages to the current user message using AI SDK `ModelMessage` types. Do not call a separate search function, construct request context, or recreate the production route.

Remove creator collections from `GoldenCase`; the production product now searches the full catalog.

- [x] **Step 4: Remove obsolete comparison modes**

Simplify `scripts/eval.ts` to run the one production configuration. Delete CLI flags and output for:

- reranking on/off;
- comparison mode;
- creator-scoped collections.

The retrieval package exposes one strict production choice, so the chat eval exercises the same path without a rerank flag.

- [x] **Step 5: Run eval tests and one live case**

Run:

```bash
pnpm vitest run src/server/evals/score.test.ts src/server/evals/summary.test.ts
pnpm eval
```

Expected: unit tests PASS; the live suite completes through `nexusAgent.generate` and reports its scorer results. If provider credentials are unavailable, record that exact environmental limitation in the PR and do not add a fallback implementation.

The unit tests passed. The live suite reached the production agent, gateway, and database, but the gateway returned a 408 after its 300-second upstream headers timeout for `zai/glm-5.3-flash`. This external timeout is recorded in the PR rather than hidden behind application retry or fallback logic.

- [x] **Step 6: Commit**

```bash
git add src/server/evals/golden.ts src/server/evals/run.ts src/server/evals/run.test.ts src/server/evals/score.ts src/server/evals/score.test.ts src/server/evals/summary.ts src/server/evals/summary.test.ts scripts/eval.ts
git commit -m "refactor(evals): exercise the native agent path"
```

### Task 6: Delete the replaced architecture

**Files:**
- Delete: `src/server/ask.ts`
- Delete: `src/server/ask.test.ts`
- Delete: `src/server/answer.ts`
- Delete: `src/server/answer.test.ts`
- Delete: `src/server/domain/scope.ts`
- Delete: `src/server/domain/scope.test.ts`
- Delete: `src/server/domain/roster.ts`
- Delete: `src/server/domain/creators.ts`
- Modify or delete remaining imports found by search

**Interfaces:**
- Consumes: the native production, UI, and eval paths completed in Tasks 1–5.
- Produces: one compiling architecture with no exports or imports from the former ask/answer, scope, roster, or custom citation pipeline.

- [x] **Step 1: Prove the legacy modules have no production callers**

Run:

```bash
rg -n 'from "~/server/(ask|answer)"|domain/(scope|roster)|SearchCapture|SearchOutcome|persistTurn|recallModelMessages|data-citations|creatorHandles|resolveScope|buildEvidencePacket|evidenceToCitations' src scripts
```

Expected: only the legacy files themselves, old tests, or clearly obsolete imports remain. Resolve any live caller through the native architecture before deleting a module.

- [x] **Step 2: Delete the old pipeline**

Delete the files above and remove types used only by them, including `Ask`, `AskChunk`, `HistoryMessage`, and the old UI data-part citation map.

Do not preserve compatibility wrappers, deprecated exports, or forwarding functions.

- [x] **Step 3: Confirm the deletion boundary**

Run:

```bash
rg -n 'from "~/server/(ask|answer)"|domain/(scope|roster)|SearchCapture|SearchOutcome|persistTurn|recallModelMessages|data-citations|creatorHandles|resolveScope|buildEvidencePacket|evidenceToCitations|REFUSAL_TEXT' src scripts
```

Expected: no matches.

- [x] **Step 4: Run the full unit suite and type-check**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(chat): remove custom orchestration"
```

### Task 7: Verify persistence, reload, and user-visible behavior

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DESIGN.md`

**Interfaces:**
- Consumes: the complete native chat path and its passing automated checks.
- Produces: verified browser/database behavior and architecture documentation matching the shipped implementation.

- [x] **Step 1: Start the application and verify the native round trip**

Run:

```bash
pnpm dev
```

Use the collaborative browser against the local app and complete these checks with a fresh thread:

1. Send a greeting. The agent can answer without a tool call.
2. Ask a catalog question. At least one `searchCreatorCatalog` tool part streams and the final answer contains working timestamp citations.
3. Ask a follow-up that needs another search. The agent can make another tool call within the same turn/thread.
4. Ask an unsupported catalog question. The answer plainly explains the lack of evidence without relying on the former exact sentence.
5. Reload the page and reopen the thread. User text, assistant text, tool output, and citation links still render.
6. Open another user's thread ID in a request. The ownership guard rejects it.

Inspect the saved messages through the existing thread API or database and confirm the tool result is stored as a native Mastra/AI SDK part rather than `data-citations`.

The local browser check covered a direct greeting, a cited catalog search, a second cited search in the same thread, a model-authored out-of-scope refusal, and a reload that restored both citation sets. Route and thread tests cover the ownership guard and native message conversion.

- [x] **Step 2: Run the production checks once**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: PASS. Do not repeat the full suite unless a subsequent change can affect it.

- [x] **Step 3: Update architecture documentation**

Document only the final path:

```text
useChat -> /api/chat -> handleChatStream -> nexusAgent -> Memory
                                      -> searchCreatorCatalog -> retrieve
```

State that search is agent-directed, the step limit is 30, all thread messages are loaded for now, catalog retrieval is global with strict reranking, and citations come from persisted structured tool output.

Remove documentation for custom ask/answer orchestration, request-scoped search capture, manual persistence, creator filtering, exact refusal matching, the two-step limit, and message truncation.

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/DESIGN.md
git commit -m "docs: describe native chat architecture"
```

### Task 8: Update issue #24 and open the pull request

**Files:**
- No repository files unless final review finds a documentation mismatch

**Interfaces:**
- Consumes: the reviewed branch diff and all validation evidence from Task 7.
- Produces: an updated issue #24, a non-draft PR against `main`, and the merged change after CI passes.

- [ ] **Step 1: Review the final diff against GitHub main**

Run:

```bash
git fetch origin main
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git status --short
```

Review every changed file. Confirm there is one chat path, one memory instance, one production retrieval mode, and one citation representation.

- [ ] **Step 2: Push and update the issue**

Push the completed branch and update issue #24 with the final behavior and validation evidence. Keep the issue focused on the resulting architecture rather than the abandoned implementation details.

- [ ] **Step 3: Open a real pull request**

Create a non-draft PR against `main` with a conventional title such as:

```text
refactor(chat): use native Mastra orchestration
```

The PR description should state the concrete problem, the resulting native flow, the intentionally changed behaviors, and the checks run. Link issue #24.

- [ ] **Step 4: Merge after CI is green**

Inspect CI and review feedback. Fix failures that are caused by this branch, rerun only the relevant checks, then merge the PR as authorized by the user. Delete the remote feature branch after merge if GitHub does not do it automatically.
