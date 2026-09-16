# Native Mastra Chat Design

**Issue:** [#24](https://github.com/builtbyrishabh/nexus/issues/24)

## Goal

Replace Nexus's custom chat orchestration with the smallest supported Mastra and AI SDK architecture. Mastra owns the agent loop and conversation memory, its AI SDK adapter owns stream conversion, and application code owns only authentication, thread authorization, catalog retrieval, and citation rendering.

The existing chat history does not need to survive this migration. The existing React interface, thread sidebar, retrieval quality, and timestamped inline citations remain product requirements.

## Starting point

Issue #24 starts from GitHub `main` after PRs #19, #21, and #23. No earlier feature branch remains in the final diff.

The current flow has overlapping owners:

```text
useChat
  → Next.js route
  → manual history recall
  → ask.ts state machine
  → Mastra agent tool loop
  → mutable SearchCapture
  → AskChunk
  → manually rebuilt AI SDK stream
  → manual message persistence
```

The fixed search phase, capture side channel, custom stream protocol, and manual memory lifecycle exist to preserve restrictions that are no longer product requirements.

## Target architecture

```text
React useChat
  → authenticated Next.js route
  → Mastra handleChatStream
  → Nexus agent with native Memory
  → optional searchCreatorCatalog calls
  → existing retrieval pipeline
  → native AI SDK UI stream
```

The browser sends only the newest user message and the thread ID. The route authenticates the user, validates the request, checks ownership of an existing thread, and calls `handleChatStream`. It passes the Clerk user ID as the memory resource, the chat ID as the memory thread, the request abort signal, and a maximum of 30 agent steps.

The registered singleton agent owns its instructions, model, memory, and one catalog search tool. No per-request agent factory is needed because the tool has no per-request resource such as LessonPlay's sandbox. The search tool is stateless and searches the complete ingested catalog.

## Agent behavior

The agent decides whether to search. Greetings and ordinary clarification can be answered without a tool call. Catalog claims must be based on evidence returned by `searchCreatorCatalog`, including evidence saved in the same conversation's memory.

The agent may search multiple times, reformulate a query, compare results, give a supported partial answer, or explain that the available videos do not answer the question. Missing evidence and refusal wording belong to the system prompt; the application does not author or normalize the response.

The loop stops when the model finishes or after 30 model steps. There is no mandatory first tool call, tool-choice override, two-step state machine, single-execution guard, or early abort after an empty result. Internal model reasoning is not sent to the UI.

## Search tool

`searchCreatorCatalog` accepts one non-empty standalone query. It calls the existing `retrieve()` pipeline with strict reranking enabled and returns a structured result:

```ts
type CatalogSearchResult = {
  evidence: Array<{
    citationId: string;
    text: string;
    title: string;
    url: string;
    startSec?: number;
    timestamp?: string;
  }>;
};
```

`citationId` is the existing chunk ID. An empty `evidence` array is a successful search with no relevant material. Retrieval or provider failures throw and remain tool errors, allowing the native loop to retry or explain the failure. The tool does not use `RequestContext`, mutate shared state, resolve creator scope, or return separate outcome notes.

Creator filtering is removed. Every user can already search the same complete ingested catalog, and creator names belong in the semantic search query. The reusable lower-level retrieval filter may remain if another retrieval caller needs it; the chat path does not supply one.

The hybrid dense and sparse retrieval, reciprocal-rank fusion, reranking, relevance floor, and neighbor expansion remain unchanged. Strict reranker failure behavior remains explicit so a provider failure cannot silently bypass the relevance floor.

## Memory and threads

The agent receives one shared `Memory` instance backed by the existing `PostgresStore`. Its configuration uses `lastMessages: Number.MAX_SAFE_INTEGER` so Mastra loads the entire thread for now instead of applying its default ten-message window. Semantic recall, observational memory, summarization, and custom context processors remain disabled.

Mastra saves user, assistant, and tool messages during the native agent run. Application code no longer reconstructs plain question and answer records, recalls a second model-specific history shape, or saves an assistant message after streaming.

Native title generation creates a short sidebar title after the first turn. Thread list, message loading, rename, and delete remain thin operations over the same Memory instance. `toAISdkMessages(..., { version: "v7" })` converts stored messages for `useChat` hydration.

An existing thread must belong to the authenticated Clerk user before it can be read, renamed, deleted, or continued. A missing thread is valid for the first turn and Mastra creates it with the authenticated user as its resource. Existing pre-refactor threads may be discarded; no compatibility reader or data migration is added.

## Citations

Search tool results are the citation store. Each evidence item contains a stable `citationId` plus server-derived title, URL, and timestamp metadata. Mastra persists the tool results with the conversation, and its UI message conversion restores them after reload.

The model cites a claim with `[cite:<citationId>]`. It may reuse a citation from an earlier search in the same thread because chunk IDs remain stable. React builds one citation lookup from successful `searchCreatorCatalog` tool parts across all loaded messages. The answer renderer replaces each valid marker with the existing timestamped deep-link and removes unresolved markers rather than trusting a model-authored destination.

This replaces per-search `[1]` numbering. Numbering cannot identify evidence unambiguously after multiple tool calls or cross-turn reuse. The user-facing link still displays a timestamp, preserving the current experience.

No parallel citation table or custom persistence path is added. A focused integration test must prove that structured tool results survive native memory persistence and `toAISdkMessages` conversion before the old persistence code is removed.

## Transport and React

The existing `useChat` and `DefaultChatTransport` arrangement remains. It continues sending only the newest user message because Mastra Memory is authoritative for history.

The Next.js route uses `handleChatStream` with AI SDK version 7 and returns `createUIMessageStreamResponse`. It does not inspect Mastra stream chunks, construct text start/delta/end events, collect an answer, emit `data-citations`, or call a persistence function.

The UI renders user and assistant text as it does today. Tool parts remain hidden except that completed catalog-search outputs contribute to the citation lookup. Progress indicators continue to derive from `useChat` status. No chat redesign is part of this refactor.

## Errors and cancellation

Malformed and unauthenticated requests return HTTP errors before agent execution. Cross-user thread access returns a not-found response. The request's abort signal is passed to native agent execution so stopping the client stream cancels the run.

An empty search result is ordinary tool output. A thrown retrieval error is a tool error. Mastra's native loop may retry or report that failure within its step budget; the application does not convert it into “not covered.” Unrecovered stream errors use the existing generic client error state.

## Evaluation and tests

Evals call the same configured agent, search tool, memory-independent execution options, prompt, and 30-step budget as production. They inspect the evidence returned in tool results and semantically grade whether answers are grounded and whether missing evidence is handled appropriately. Exact refusal-string detection and tests for the deleted fixed state machine are removed.

Focused automated coverage includes:

- search tool structured results, empty results, and thrown retrieval failures;
- stable citation extraction and rendering across multiple tool calls and earlier turns;
- native memory round-trip of tool results through AI SDK v7 messages;
- authenticated thread ownership at read, continue, rename, and delete boundaries;
- request validation and forwarding of the 30-step budget and abort signal;
- representative eval cases for a greeting, one grounded answer, contextual follow-up, multiple searches, missing evidence, and provider failure.

The implementation is complete when relevant tests and type checking pass, the revised golden eval reports grounding and citation results, and a focused live check verifies a cited answer and reload. Quality, latency, and cost observations are reported without assuming the refactor improves every metric.

## Removals

Delete code whose only purpose is the superseded architecture:

- `src/server/ask.ts` and its tests;
- `src/server/answer.ts` and exact-refusal tests;
- `SearchCapture`, capture accessors, execution guard, and outcome state;
- `resolveScope` and its tests if no non-chat caller remains;
- `Ask`, `AskChunk`, `HistoryMessage`, creator-name maps, and other unused domain types;
- manual model-history recall and turn persistence;
- route-level stream reconstruction and citation data parts;
- stale design comments and documentation describing a forced single search or generation-only history.

Deletion is determined by actual remaining usage. No pass-through wrapper or compatibility abstraction is retained merely to preserve a filename.

## Scope boundaries

This refactor does not redesign the UI, change ingestion, replace the retrieval pipeline, add semantic or observational memory, introduce a queue or service, migrate old chat history, or add a generic agent framework. It uses the installed Mastra, AI SDK, Next.js, Clerk, tRPC, and Postgres integrations directly.

## References

- [Mastra Next.js integration](https://mastra.ai/integrations/frameworks/next-js)
- [Mastra memory](https://mastra.ai/docs/memory/overview)
- [LessonPlay native Mastra route](https://github.com/builtbyrishabh/lessonplay/blob/main/src/app/api/chat/route.ts)
- [LessonPlay memory configuration](https://github.com/builtbyrishabh/lessonplay/blob/main/src/mastra/agents/lesson-memory.ts)
- [Vercel AI SDK chatbot UI](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
