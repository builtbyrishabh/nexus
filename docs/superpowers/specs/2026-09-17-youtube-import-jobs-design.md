# Durable YouTube channel imports

## Problem

Channel ingestion already has the expensive, idempotent source pipeline, but it only runs inside a CLI process. The product needs an authenticated, promptly returning API; durable execution for up to 50 videos; visible per-video outcomes; and safe retries that never reset successful work. Canonical sources remain global, while `user_source` remains the only search-authorization boundary.

## Usage (caller's view)

The browser sees three protected tRPC operations:

```ts
const { jobId } = await api.imports.start.mutate({ scope: "@creator" });
const job = await api.imports.byId.query({ jobId });
await api.imports.retryFailures.mutate({ jobId });
```

`start` accepts every YouTube scope the existing loader accepts and returns after the job and durable workflow are created. `byId` returns parent state, derived counts, and ordered video outcomes. `retryFailures` requeues only failures. User identity always comes from Clerk context, never request input.

Internally the API starts one workflow with only the persisted job ID:

```ts
await start(runChannelImport, [jobId]);
```

## Shape

Two relational tables are the product state:

- `channel_import_job`: owner, submitted scope, canonical creator identity, lifecycle state, safe error, workflow run ID, and timestamps.
- `channel_import_item`: one exact discovered video, its stable order, lifecycle state, attempt count, outcome fields, and optional canonical source ID.

Item states are `queued | processing | ingested | skipped | failed`. Job states are `queued | discovering | processing | completed | failed`; `completed` may include item failures, while `failed` means discovery or orchestration could not produce/finish the batch. Counts are derived from item states instead of synchronized counters.

The workflow runs discovery as one durable step with a hard server-side limit of 50, persists the exact ordered refs, then processes groups of three with `Promise.all`. Each video is its own step. It enters `processing`, reuses `ingestSource`, attaches `user_source` idempotently for both ingested and skipped outcomes, and only then records the terminal item state. A crash after source ingestion is repaired by retry: the pipeline's existing gates return the canonical source ID, then membership is attached.

Workflow infrastructure owns resumption; Postgres owns user-visible state. Per-video provider errors are normalized and persisted rather than escaping and aborting siblings. Step-level automatic retry is disabled for the paid ingestion step so an infrastructure replay cannot silently repeat transcription spend. Explicit retry re-enters the established provenance/hash gates.

Channel resolution stores a stable creator key from YouTube's canonical vanity URL, falling back to the channel ID. This lets #31's source-library roster work for every accepted scope without trusting an alias supplied by the browser.

The module map is deliberately short:

- `src/server/db/schema.ts`: job/item persistence and constraints.
- `src/server/imports/channel-import.ts`: state summaries, owned reads, creation, retry preparation, and workflow start.
- `src/workflows/channel-import.ts`: discovery and per-video durable steps.
- `src/server/api/routers/imports.ts`: thin protected tRPC boundary.
- `src/server/ingest/youtube-loader.ts`: canonical channel identity in addition to the existing loader.

The deep public surface is three operations; execution, storage, limits, membership ordering, and error normalization remain hidden.

## Synthesis decision

The deployment-native workflow candidate is the base because the repository is deployed on Vercel and has no persistent worker. The competing Postgres-queue design contributed the relational job/item model, derived summaries, ownership predicates, and retry invariants. Its leases, polling loop, and `SKIP LOCKED` dispatcher were rejected because they still require a separate always-on executor; a Vercel cron would add latency and retain function-duration risk.

## Tradeoffs accepted

- We accept one small runtime dependency and its generated internal route in exchange for crash/redeploy-safe execution on the existing host.
- We accept a per-job concurrency limit of three, matching the established ingestion contract; a global spend scheduler is deferred until measurement shows competing jobs are a problem.
- We accept storing the Workflow run ID for operations/debugging while keeping it out of the browser contract.
- We accept item rows for at most 50 videos in exchange for simple progress queries and exact retry targets.

## Alternatives considered

- A Postgres queue plus long-running worker has excellent explicit claim semantics, but no such worker exists in the current deployment. Adding a second host is more infrastructure than the feature needs.
- A Postgres queue drained by Vercel Cron still runs long videos inside one serverless invocation and introduces polling latency; its smaller dependency surface does not hide execution complexity.
- `after()` or an unawaited promise returns promptly but is not durable across crashes or deployments.
- One job row with JSON outcomes makes retry, ordering, counting, and concurrent updates application-level coordination rather than database invariants.

## Open questions and risks

- Can two users import the same never-before-seen video concurrently and duplicate expensive pre-commit work? Yes; canonical database writes remain safe, but a global/source-keyed spend lock should only be added if real concurrent usage demonstrates the need.
- Can every video fit the step runtime and memory envelope, especially guarded STT? This requires the issue's manual real-channel run; the existing duration and opt-in spend guards remain unchanged.

## Next implementation step

Add the job/item schema and pure summary/state tests first, then connect the durable workflow and protected API to those stable contracts.
