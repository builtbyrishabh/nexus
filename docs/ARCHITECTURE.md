# Nexus architecture

Nexus is an authenticated React chatbot for asking grounded questions about an ingested creator catalog. It uses Mastra for the agent loop and conversation memory, AI SDK for the browser transport, and Postgres for content and vectors.

The rule for this architecture is simple: use native library behavior for chat, and own code only where the product needs custom retrieval or timestamp citations.

## Request path

```text
React useChat
    -> POST /api/chat
    -> Clerk auth + request validation + thread ownership
    -> Mastra handleChatStream
    -> nexusAgent
       -> native Memory (recall and persistence)
       -> searchCreatorCatalog when catalog evidence is needed
          -> hybrid retrieve -> RRF -> strict rerank -> neighbors
    -> AI SDK UIMessage stream
    -> React citation renderer
```

The client sends the newest `UIMessage` and a client-minted UUID thread ID. The server accepts only its text content and ID, stripping client metadata and rejecting tool parts before forwarding a native `UIMessage`. It never accepts a user ID from the browser: the authenticated resource ID comes from Clerk, and existing thread ownership is verified before the agent runs.

The route does not recall history, assemble model messages, control tool phases, translate stream events, or persist turns. Mastra memory and `handleChatStream` own those responsibilities.

## Agent behavior

`nexusAgent` owns one system prompt, one model, one `Memory`, and one search tool.

- Search is optional. Greetings and ordinary conversation can be answered directly.
- Search is repeatable. The agent may call it as needed, up to 30 total steps.
- Catalog claims must come from returned evidence.
- Missing evidence is handled by the system prompt. There is no exact refusal sentence in code.
- Memory recalls the latest 20 stored messages for the model; the UI can still load the complete thread.
- Native `ToolCallFilter` removes previous turns' tool calls and results from model input without deleting stored messages. Current-run evidence stays available; follow-ups can search again.
- Thread creation receives a deterministic title from the first question, shared with the optimistic sidebar. No title-generation model call is needed.

## Retrieval

The search tool accepts one input:

```ts
{ query: string }
```

It always searches the full ingested catalog. There is no creator scope, request context, or rerank toggle.

The fixed retrieval pipeline is:

```text
dense top-20 + sparse top-20
    -> reciprocal rank fusion (k=60)
    -> cross-encoder rerank
    -> top-5
    -> adjacent chunk expansion
```

Reranking is strict: provider failure fails the search instead of silently changing retrieval behavior.

## Citations

Search returns structured tool output:

```ts
type CatalogEvidence = {
  citationId: string; // stable chunk ID
  text: string;
  title: string;
  url: string;        // timestamp deep link when available
  startSec?: number;
  timestamp?: string;
};
```

`toModelOutput` sends only `citationId`, `text`, and `title` to the model. The full result remains in memory and the UI for citation rendering.

The agent cites a claim as `[cite:<citationId>]`. The React client builds one registry from completed `searchCreatorCatalog` tool parts across the conversation and renders each marker as a timestamp link.

Because tool calls and results are native AI SDK message parts persisted by Mastra, citations use the same path while streaming and after reload. There is no parallel `data-citations` protocol.

The recall window and tool filter reduce context growth across turns; they are not a hard token cap within one run. The 30-step ceiling remains. The installed `TokenLimiterProcessor` is not enabled: it counts raw tool results before projection and can remove unsaved citation evidence from the active message list. Any future token guard must preserve the full citation transcript.

## Ingestion

Ingestion remains an offline pipeline:

```text
YouTube source
    -> transcript or AssemblyAI fallback
    -> timestamped chunks
    -> contextual retrieval blurbs
    -> embeddings + tsvector
    -> Postgres upsert
```

The query path never performs ingestion work. Transcript provenance and content hashes make repeated ingestion safe and avoid repeating paid work.

## Evals

`pnpm eval` calls the registered production agent with the same tool and 30-step limit used by chat. It reads evidence from the agent's structured tool results and runs Mastra's faithfulness, answer relevancy, and context precision scorers.

Unsupported-answer behavior is judged semantically. The eval checks whether the answer declined to make an unsupported catalog claim; it does not compare against a required sentence. Answerable cases must also emit at least one citation marker, and every marker must resolve to evidence returned by the production tool.

## Custom code we keep

1. Transcript loading, timestamped chunking, and ingestion skip gates.
2. Contextual retrieval blurbs.
3. Hybrid retrieval, RRF, strict reranking, and neighbor expansion.
4. Stable chunk-ID citation parsing and rendering.
5. Authentication and thread ownership at the HTTP boundary.

Agent looping, memory, streaming, tool persistence, and UI message transport remain library-native. The route supplies the initial thread title.

## References

- [Mastra agents and memory](https://mastra.ai/docs/agents/overview)
- [Mastra AI SDK integration](https://mastra.ai/docs/frameworks/agentic-uis/ai-sdk)
- [Vercel AI SDK chatbot guide](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
