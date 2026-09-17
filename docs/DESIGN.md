# Nexus design contract

This document defines the small set of application-owned contracts. Chat orchestration follows native Mastra and AI SDK behavior described in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Product contract

Nexus answers questions about the ingested creator catalog with claims grounded in retrieved source material and cited to the relevant timestamp.

- The current searchable collection is the complete ingested catalog.
- Catalog claims require search evidence.
- If evidence is insufficient, the agent says so without filling the gap from outside knowledge.
- Citations use stable chunk IDs and must work during streaming and after thread reload.

## Domain types

```ts
type SourceMeta = {
  kind: "youtube_video" | "book";
  externalId: string;
  title: string;
  url: string;
  author?: string;
  publishedAt?: Date;
};

type Segment = {
  text: string;
  startSec?: number;
  endSec?: number;
};

type Evidence = {
  chunkId: string;
  sourceId: string;
  text: string;
  context?: string;
  score: number;
  locator?: { startSec: number; endSec: number };
  source: { title: string; url: string };
};

type CatalogEvidence = {
  citationId: string;
  text: string;
  title: string;
  url: string;
  startSec?: number;
  timestamp?: string;
};
```

`Evidence` is the internal retrieval result. `CatalogEvidence` is the full structured tool output shared with persisted memory, the eval harness, and the browser. Native `toModelOutput` projects only `citationId`, `text`, and `title` into model input.

## Storage

The application owns two content tables:

```text
source
  id, kind, external_id, title, url, author, creator_handle,
  published_at, content_hash, metadata, created_at, updated_at

chunk
  id, source_id, chunk_index, text, context_text, embedding,
  tsv, start_sec, end_sec, metadata, created_at
```

The embedding input is `context_text + "\n" + text`. Raw text and contextual text remain separate for display, lexical search, and eval context.

Mastra's Postgres store owns chat threads and messages. Nexus does not define another conversation schema.

## Ingestion seam

```ts
interface SourceLoader {
  discover(scope: string, options?: { limit?: number }): AsyncIterable<SourceRef>;
  loadTranscript(ref: SourceRef): Promise<Transcript>;
  loadMeta(ref: SourceRef): Promise<SourceMeta>;
}
```

`ingestSource` checks transcript provenance and content hash before contextualization, embedding, or writes. `ingestChannel` runs sources with bounded concurrency and reports each outcome independently.

## Retrieval seam

```ts
function retrieve(
  query: string,
  options?: { topK?: number },
): Promise<Evidence[]>;
```

Retrieval always runs the same full-catalog pipeline. Filtering and rerank variants are outside the current product contract.

## Search tool seam

```ts
searchCreatorCatalog({ query }): Promise<{
  evidence: CatalogEvidence[];
}>;
```

The tool converts `Evidence.chunkId` to `CatalogEvidence.citationId`. This stable identifier replaces positional citation numbering.

## Chat HTTP boundary

The browser sends:

```ts
{
  threadId: string; // UUID
  message: UIMessage; // latest user message
}
```

The route:

1. authenticates with Clerk;
2. validates the envelope, accepts only user text parts, and strips client metadata;
3. verifies ownership if the thread already exists;
4. calls `handleChatStream` for agent `nexus` with the authenticated resource ID, a thread ID and deterministic first-question title, the request abort signal, and `maxSteps: 30`;
5. returns `createUIMessageStreamResponse({ stream })`.

There is no application-level ask function, manual history assembly, persistence callback, or custom stream protocol. Memory recalls 20 recent messages, and native `ToolCallFilter` removes earlier runs' tool payloads only from the model prompt. Current-run evidence stays available. The saved transcript retains full citation data.

## Citation rendering

The model writes `[cite:<citationId>]` after the supported claim. The UI reads completed native tool parts, validates each output with `catalogSearchResultSchema`, and builds:

```ts
ReadonlyMap<string, CatalogEvidence>
```

The renderer resolves a marker through this map and displays `[mm:ss]` when a timestamp exists. An unresolved marker stays visible as plain text so a model error is observable.

## Evaluation contract

The golden set contains answerable and unsupported questions. Each case executes `nexusAgent.generate` with the production tool and step limit.

- Answerable cases receive faithfulness, answer relevancy, and context precision scores.
- Unsupported cases are checked semantically for an appropriate evidence-based decline.
- Answerable cases must cite at least one returned evidence ID, with no unresolved IDs.
- A wrongful decline on an answerable case receives zero axis scores.
- The eval harness has no creator-scope or rerank comparison mode.
