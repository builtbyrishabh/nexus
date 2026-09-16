# Nexus — YouTube Channel RAG Chatbot

> Chat with an entire YouTube creator's catalog. Grounded, cited-to-the-second answers,
> delivered as an authenticated web app.

A portfolio-grade, production-shaped RAG system. The goal is **real work, not a prototype**:
smart retrieval, real evals, a grounded web chat.

---

## Guiding principle: native-first, minimal glue

**Use the libraries as they ship. Write custom code only where it measurably improves
answer quality.** Every component below is tagged:

- 🟢 **Native** — use the library primitive as-is, ~zero glue.
- 🟡 **Thin glue** — small custom code, *justified because it lifts quality* (with the number).

If a piece is 🟡, the doc says *why the glue earns its place*. If we ever add glue that
doesn't move an eval score, we delete it.

---

## Stack

| Layer | Choice | Why | Tag |
|---|---|---|---|
| Agent / RAG core | **Mastra** | Native RAG, tools, memory, agent loop, **built-in eval scorers** | 🟢 |
| Delivery | **Next.js** web app + **Clerk** auth | One authenticated web surface; the streaming chat + Panel both reduce to `ask()` | 🟢 |
| Web UI | Next.js + AI SDK `useChat` | Streaming chat UI primitive | 🟢 |
| Vector + keyword store | **Neon Postgres** (`pgvector` + `tsvector`) | Dense *and* sparse retrieval in one DB → hybrid with zero extra infra | 🟢 |
| Embeddings | `text-embedding-3-small` | Cheap, strong default | 🟢 |
| Rerank + generation | via **AI Gateway** | One endpoint for both; easy provider swaps | 🟢 |
| Transcript ingest | `youtubei.js` discovery + `youtube-transcript` + AssemblyAI fallback | STT (via AI SDK `transcribe()`) only when no caption track exists | 🟡 |

**Why Mastra behind a plain Next.js app:** Mastra is the brain (RAG + tools + memory + evals +
agent loop); Next.js is the delivery surface. The `/api/chat` route streams `ask()` over the AI
SDK's `useChat` transport, so there's no custom bridge code between the agent and the UI.

---

## System shape

A RAG chatbot is **three sync jobs in one request** + **one async job offline**.

```
                    ┌─────────────────── INGESTION (async, offline) ───────────────────┐
  YouTube video  →  fetch transcript  →  chunk (timestamped)  →  add context  →  embed  →  upsert
                    (caption API /       (200–300 tok,           (Contextual      (dense +   (pgvector
                     AssemblyAI fallback) ~15% overlap)           Retrieval)       sparse)    + tsvector)
                    └───────────────────────────────────────────────────────────────────┘

                    ┌─────────────────── QUERY PATH (sync, one request) ───────────────┐
  user message  →  search (one tool call)  →  hybrid retrieve  →  RRF fuse  →  rerank  →  generate + stream
  (web)            (agent, once per turn)     (dense top-20 +     (k=60)      (→ top-5)   (grounded, cited
                                              BM25 top-20)                                [mm:ss] deep-links)
                    └───────────────────────────────────────────────────────────────────┘
```

- **Ingestion is async**; the query path never waits on it.
- **One search per turn** (issue #20): the agent calls the `searchCreatorCatalog` tool exactly once,
  then answers only from that turn's Evidence — no re-retrieval loop.
- **Citations stream before tokens** (a typed `data-citations` part), the token stream merges in.
- Delivery is the web app only: the streaming chat and the Panel both reduce to the same `ask()`.

---

## Build tiers (each gated by evals)

Build in order. **Do not advance a tier until its evals pass.** The tiered lift —
measured, not asserted — is the portfolio story.

> **Status.** Tier 1 ships. From Tier 2, conversational context (multi-turn recall) and
> **retrieval-as-a-tool** ship — but the tool runs **one search per turn**, not a re-retrieval loop.
> Everything else below (sub-query decomposition, the reflection loop, semantic cache, guardrails)
> is roadmap, not built.

### Tier 1 — Production baseline (table stakes)

| Component | How | Tag |
|---|---|---|
| Timestamped chunking | Recursive split 200–300 tok, ~15% overlap, keep `{videoId, startSeconds}` per chunk | 🟡 *enables `[mm:ss]` citations — core UX* |
| **Contextual Retrieval** | Prepend 50–100 tok LLM blurb per chunk (cheap model + prompt caching) before embedding | 🟡 *−49% retrieval failures (Anthropic)* |
| **Hybrid retrieval** | pgvector cosine (top-20) + Postgres FTS/BM25 (top-20) | 🟡 *dense misses exact names/jargon; one SQL each* |
| **RRF fusion** | `score = Σ 1/(k+rank)`, k=60 → top-10 | 🟡 *~30 lines; standard rank fusion, no score normalization* |
| Reranking | Cross-encoder / Cohere via AI Gateway → top-3 | 🟢 |
| Grounded generation | Context-only prompt + "I don't have that in his videos" fallback + citations | 🟢 |
| **Evals** | Mastra scorers: **Faithfulness, Answer Relevancy, Context Precision** on a golden set | 🟢 |

> Contextual Retrieval + hybrid + rerank together: **−67% retrieval failures**. This tier
> alone beats most "RAG demos."

### Tier 2 — Agentic layer (the "much more")

| Component | How | Tag |
|---|---|---|
| Conversational context | Prior turns fed to the model so it resolves references ("the second one") | 🟢 *(shipped; generation-only, never a retrieval input)* |
| Retrieval as a tool | Agent decides what to search within server-owned scope; **one search per turn** | 🟢 *(shipped, issue #20/#21)* |
| Sub-query decomposition | Split multi-hop questions ("early vs recent videos") into sub-queries | ⚪ *roadmap — not built* |

### Tier 3 — Frontier polish (cheap, high-signal — do selectively)

| Component | How | Tag |
|---|---|---|
| Reflection loop | retrieve → critique → refine, **gated on low confidence / failed faithfulness** | ⚪ *roadmap — would add a second retrieval; not built* |
| Semantic cache | cache answers for near-duplicate questions | ⚪ *roadmap — not built* |
| Guardrails | prompt-injection check in, PII/off-topic check out | ⚪ *roadmap — not built* |
| Observability | surface Mastra traces ("why this chunk was retrieved") | ⚪ *roadmap — not built* |

---

## Canonical settings (the defaults)

| Concern | Value |
|---|---|
| Chunk size / overlap | 200–300 tokens / ~15% |
| Chunk context blurb | 50–100 tokens, cheap model, prompt-cached |
| Dense retrieve | pgvector cosine, top-20, HNSW index |
| Sparse retrieve | Postgres `tsvector`/BM25, top-20 |
| Fusion | RRF, k=60 |
| Rerank | → top-5 (the one `ANSWER_TOP_K`) |
| Retrieval | one search per turn |
| Eval axes | Faithfulness · Answer Relevancy · Context Precision |

---

## Where the glue actually lives

To keep "as little glue as possible" honest, the **only** custom code we own is:

1. **Transcript → timestamped chunks** (ingestion) — needed for second-accurate citations.
2. **Contextual Retrieval blurb generation** — needed for the −49% lift.
3. **The hybrid+RRF retrieval tool** — ~30 lines: two SQL queries + rank fusion.
4. **The scope + phase control around `ask()`** — server-owned creator scope and the
   search-then-answer step control that keeps retrieval to one search per turn.

Everything else — agent loop, memory, streaming, eval scorers, web UI — is **library-native**.
If a future addition isn't on this list and doesn't move an eval number, it doesn't ship.

---

## Roadmap (later, out of scope now)

- Add **books / long-form docs** as a second source (same pipeline, new ingester).
- The retrieval tool and eval harness are source-agnostic by design, so expanding scope
  is a new ingester + new golden set, not a rewrite.

---

## Reference set

- [Vercel — Production RAG architecture](https://vercel.com/kb/guide/rag-chatbot-production-architecture-on-vercel)
- [Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
- [Mastra — RAG overview](https://mastra.ai/guides/rag/overview) · [built-in scorers](https://mastra.ai/docs/evals/built-in-scorers)
- [Vercel AI SDK RAG starter](https://github.com/vercel/ai-sdk-rag-starter)
