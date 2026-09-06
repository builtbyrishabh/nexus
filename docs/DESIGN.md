# Nexus — Design Contract (the load-bearing 20%)

This is the source of truth for the decisions that ripple: the skill, the vocabulary,
the schema, the interfaces, the output, and the flow. The other 80% (normalization,
batching, retries, SQL) is implementation detail that must conform to these contracts.

See `ARCHITECTURE.md` for the strategy/best-practices behind these choices.

**Locked decisions (co-decided):**
- Citations: **inline `[n]` markers in text + a structured `Citation[]`** with `[mm:ss]` deep-links.
- Retrieval: **fixed hybrid pipeline** (dense + sparse → RRF → rerank) for Tier 1. Agentic loop is a later, flag-gated Tier 2.
- Embeddings: **`text-embedding-3-small`, 1536 dims**.

**Slice 1 status (2026-09-04):** Contextual Retrieval, hybrid dense+sparse retrieval, RRF
fusion, and ±1 neighbor expansion are **built**. Reranking was deferred until a golden eval
set existed (so its lift is measured, not asserted) — now delivered in Slice 2.

**Slice 2 status — evals + reranking (Tier 1 complete):** The **golden set**
(`src/server/evals/golden.ts`) + Mastra's native **Faithfulness / Answer-Relevancy /
Context-Precision** scorers drive a harness (`pnpm eval`, gated by exit code). **Reranking**
(AI SDK `rerank` via the Gateway) now slots into `retrieve()` between RRF fusion and neighbor
expansion, off by default and toggled per-run so `pnpm eval --compare` reads the lift directly.
Provider defaults to Cohere rerank-3.5 (one env knob, `RERANK_MODEL`). The harness grades the real
query path: `prepareAnswer()` in `src/server/ask.ts` is the single definition of retrieve → refuse-or-
prompt, and both `ask()` (streaming) and the eval (blocking) finish it — no second copy to drift.

**Slice 3 status — full-channel ingest (decided 2026-09-07, rebuilt from scratch):** One command
turns a channel into a corpus without touching the query path. **Discovery** is youtubei.js
(Innertube, no API key) using its own `resolveURL` / `getBasicInfo` / channel-videos paging — we
write no id-parsing of our own. **A video is just a video:** `pnpm ingest <video>` ingests one
video; only `pnpm ingest --channel <handle | UC id | channel URL | video>` widens to the catalog (a
video resolves to its owner). **Skip gates, cheapest first:** (1) provenance — a speech-to-text
transcript is final, skip with no network; (2) `sha256(transcript)` vs `content_hash` — skip before
metadata, contextualize, embed, or write. **STT fallback is AssemblyAI** via AI SDK `transcribe()`
(`@ai-sdk/assemblyai`, own key; the Gateway does not route transcription). Audio is downloaded by
youtubei.js into memory and handed to `transcribe()` — AssemblyAI does not accept YouTube URLs. It
fires **only** on genuine no-captions (disabled / unavailable / zero segments); rate limits and
network errors rethrow so a throttle can never fan out into paid transcriptions. `TRANSCRIBE_FALLBACK`
is off by default; the provider is a code-level choice in one file; videos over **180 minutes** fail
before a byte is downloaded. **Failure semantics:** per-video isolation (`ingested | skipped |
failed`), 3 videos in flight (a constant), outcomes in discovery order, exit non-zero if any video
failed *or* nothing was indexed. No retries, resume files, or job table — the gates make "run it
again" the retry. **Gate:** ingest 60–70 Hormozi uploads (`--limit`), re-run `pnpm eval --compare`;
done when refusal + faithfulness still pass on the larger corpus, numbers recorded here.

---

## 1. The skill (product contract)

> **Nexus answers questions about a single YouTube creator's catalog, grounded strictly
> in what they actually said, with every claim cited to the exact video + timestamp —
> on web, Discord, and Telegram.**

- **In scope:** one channel's videos → grounded multi-turn Q&A + timestamped deep-links, on 3 surfaces.
- **Out of scope (now):** books, multi-channel corpora, summaries/notes, anything not
  answerable from transcripts.
- **The refusal is the product:** if the corpus doesn't cover it, Nexus says
  *"he doesn't cover that in his videos"* rather than guessing. Trust > coverage.

---

## 2. The words (domain model)

| Term | Meaning | Shape (key fields) |
|---|---|---|
| **Source** | One ingested thing (Video now, Book later) | `externalId, title, url, author, publishedAt` |
| **Segment** | Raw transcript span from a loader (pre-chunk) | `text, startSec?, endSec?` |
| **Chunk** | The retrievable unit | `text, contextText, embedding, tsv, locator, chunkIndex` |
| **Locator** | *Where in the source* → powers deep-links | `{ startSec, endSec }` |
| **Evidence** | A retrieved+ranked Chunk the model reads | Chunk + `score, source{title,url}` |
| **Citation** | What the user sees | `{ sourceTitle, url, startSec?, timestamp?, deepLink? }` |
| **Answer** | The generated response | `{ text, citations[], sources[], trace? }` |
| **Ask** | One message in a Conversation | `{ query, channel, userId, threadId }` |

Naming rule: everything is named against these terms. No `doc`, `result`, `hit` synonyms.

---

## 3. The schema (data shape)

Two tables we own. **Conversation history is NOT ours** — Mastra's native Postgres
memory owns threads/messages (less schema, native).

### `source`
```
id            uuid pk
kind          enum('youtube_video','book')
external_id   text          -- videoId; unique per kind
title         text
url           text
author        text          -- channel name
published_at  timestamptz
content_hash  text          -- idempotent re-ingest (skip unchanged)
metadata      jsonb
created_at / updated_at
unique(kind, external_id)
```

### `chunk`
```
id            uuid pk
source_id     uuid -> source(id) on delete cascade
chunk_index   int           -- ordinal within source (neighbor expansion)
text          text          -- raw chunk (display + lexical)
context_text  text          -- contextual-retrieval blurb (50-100 tok)
embedding     vector(1536)  -- embed(context_text + "\n" + text)
tsv           tsvector      -- generated from (context_text || ' ' || text)
start_sec     int null      -- Locator (video)
end_sec       int null
metadata      jsonb
created_at
-- indexes:
HNSW (embedding vector_cosine_ops)
GIN  (tsv)
index(source_id, chunk_index)
```

**Locked storage rule:** embed `context_text + "\n" + text` (vector carries context),
but store `text` and `context_text` **separately** so lexical search + display use raw text.

---

## 4. The interfaces (the seams that matter)

### a) Ingestion seam — source-agnostic (books = a new loader, not a rewrite)
```ts
/** Anything a person pastes: @handle, UC… id, channel URL, video id, video URL (→ its owner). */
type ChannelScope = string;

interface SourceLoader {
  /** Every upload of the channel `scope` belongs to, newest first, streamed page by page. */
  discover(scope: ChannelScope, opts?: { limit?: number }): AsyncIterable<SourceRef>;
  /** The expensive call. Drives the content hash. */
  loadTranscript(ref: SourceRef): Promise<Transcript>;
  /** Deferred until the pipeline has decided to write. */
  loadMeta(ref: SourceRef): Promise<SourceMeta>;
}
type SourceRef = { kind: SourceKind; externalId: string };   // identity only, on purpose
type Transcript = { segments: Segment[]; provenance: "captions" | "stt" };
type Segment = { text: string; startSec?: number; endSec?: number };
```
The orchestrator (80%) is `ingestSource(ref, loader)`: it never names a source kind. It runs the
two skip gates (provenance, then hash), and only then `loadMeta -> chunks -> context -> embed ->
upsert` in one transaction. Provenance persists in `source.metadata` as
`{ provenance, sttProvider? }` — no schema change. `ingestChannel(scope)` fans `discover()` out
over `ingestSource()` with per-video isolation.

CLI contract: `pnpm ingest <video>` (one video) · `pnpm ingest --channel <scope> [--limit N]`
(the catalog; exit 1 if any video failed or nothing was indexed) · `TRANSCRIBE_FALLBACK=true` to
allow paid STT for caption-less videos.

### b) Retrieval — one contract; hybrid+RRF+rerank hidden inside
```ts
type Evidence = {
  chunkId: string;
  sourceId: string;
  text: string;
  context?: string;   // the Contextual-Retrieval blurb — see rule below
  score: number;
  locator?: { startSec: number; endSec: number };
  source: { title: string; url: string };
};
type Filter = { sourceIds?: string[]; kind?: Source["kind"] };

function retrieve(query: string, opts?: { topK?: number; filter?: Filter; rerank?: boolean }): Promise<Evidence[]>;
```
Tier 1 internals (fixed): dense top-20 (pgvector cosine) + sparse top-20 (tsv/BM25)
→ RRF (k=60) → rerank → top-K → ±1 neighbor expansion. All built (rerank added in Slice 2, off
by default and toggled per-call via `opts.rerank`; see the Slice status notes above).

**Locked (2026-09-06, measured):** the blurb rides on `Evidence.context`. The reranker scores
`context + "\n" + text` (the exact string that was embedded), the generator sees it as a
`Context:` line in the numbered packet, and the eval judges grade against that same string.
Without it ~25% of questions naming an entity only the blurb mentions were wrongly refused.

### c) Output — inline markers + structured citations (LOCKED)
```ts
type Citation = {
  sourceTitle: string;
  url: string;
  startSec?: number;
  timestamp?: string;   // "12:04"
  deepLink?: string;    // https://youtu.be/<id>?t=724
};
type SourceCard = { sourceId: string; title: string; url: string };
type Answer = { text: string; citations: Citation[]; sources: SourceCard[]; trace?: AnswerTrace };
```
Contract: the model writes prose with inline `[1]`, `[2]` markers; each index maps 1:1 to
`citations[i]`. UI renders markers as clickable `[mm:ss]` deep-links. Evidence packet given
to the model is numbered so marker index == evidence index == citation index.

### d) The one entrypoint every surface calls
```ts
function ask(input: {
  query: string;
  channel: "web" | "discord" | "telegram";
  userId: string;
  threadId: string;
}): AsyncIterable<{ textDelta?: string; citations?: Citation[] }>;
```
Web (`useChat`), Discord, and Telegram all reduce to `ask()`. Citations stream as a
`source`/data part before/with the token stream. This is how "one codebase, three surfaces" holds.

---

## 5. The flow

**Ingest (offline, async):**
```
scope -> discover uploads (newest first, paged)
      -> per video (3 in flight, isolated):
           gate 1: provenance = stt?           -> skip (no network)
           loadTranscript (captions, else STT if flag on and genuinely no captions)
           gate 2: sha256(transcript) unchanged? -> skip (no metadata, nothing paid)
           loadMeta -> chunk -> contextualize -> embed -> upsert (one transaction)
```

**Ask (online, one request):**
```
message -> rewrite to standalone query
        -> retrieve (dense + sparse -> RRF -> rerank -> neighbors)
        -> build numbered evidence packet
        -> generate grounded answer with inline [n] markers
        -> stream textDelta + resolve citations
        -> render per surface (web parts / Discord / Telegram)
```

---

## 6. Delivery & auth (surface contract)

- **Web:** Clerk session; `useChat` streams from a route handler that calls `ask()`.
- **Discord / Telegram:** Mastra Channels + Chat SDK adapters; platform authenticates the
  user (stable `platformUserId`) — no login flow. `userId = "<channel>:<platformUserId>"`.
- **Account linking (optional, later):** `/link` in a bot -> one-time Clerk link -> map
  `(clerkUserId <-> platformUserId)` for entitlements/history. Not needed for Tier 1.

---

## 7. Open (decide when we get there)

- Generation model + whether to route via AI Gateway (embeddings stay OpenAI for dim compat).
- Query rewrite: rule-based vs a cheap model call (Tier 2).
- Eval golden-set: how many Q/A pairs, who authors them, LLM-judge model.
- **Reranker: does it earn its place?** Cohere rerank-3.5 measured ~neutral on 2 videos
  (precision +0.8pt). Re-measured at 60–70 videos as part of the Slice 3 gate; it goes on by
  default only if that shows a real lift.
- **Hedged refusals** — near-miss questions produce a refusal sentence *plus* "in fact the evidence
  shows…"; the contract says exact refusal. Strict vs refuse+nearest is still the user's call.
