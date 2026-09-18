# Source management UI

## Problem

The product can scope retrieval to a user's `user_source` memberships and can run durable channel imports, but those capabilities have no user-facing surface. A user cannot inspect their library, start an import, recover job progress after a refresh, or retry failures.

## Usage

The Sources page uses one protected overview query and focused mutations:

```ts
const overview = await api.sources.overview.query();
const { jobId } = await api.imports.start.mutate({ scope: "@creator" });
const job = await api.imports.byId.query({ jobId });
await api.imports.retryFailures.mutate({ jobId });
```

`overview` returns a bounded list of recent import summaries and every source reached through the current user's memberships. The browser polls that single snapshot only while an import is active. Video-level outcomes stay behind `imports.byId` and are loaded when a user expands a job.

## Shape

- `sources.overview`: groups `user_source → source` rows into creator cards and combines every active import with the latest 20 terminal import summaries.
- `imports.start`: persists the submitted input and lets the durable workflow resolve and discover the channel once.
- `/sources`: starts imports directly and renders empty, loading, active, partial-success, failed, and completed states.
- The existing shell uses the full sidebar on desktop and a compact Chats/Sources navigation on mobile.

`completed_with_failures` remains a display state derived from a completed job with failed items; it is not a second persistence state.

## Synthesis decision

The chosen design uses one page-shaped overview read model with resource-specific mutations. This keeps browser polling and cache coordination small while preserving the existing import API as the owner of import behavior. A competing design exposed separate library and import list queries; it was rejected because the browser would have to synchronize two independently refreshing snapshots for no product benefit.

The overview bounds terminal history while always including active jobs, so a slow import cannot disappear after a refresh. It does not persist a new frontend source model; `user_source` remains the sole searchable-library truth.

## Tradeoffs

- The first version starts imports without a preview, so an invalid input appears as a failed job instead of a preflight error.
- Creator removal is deferred until start, retry, and removal can share a clear concurrency rule.
- The library has no stored channel avatar, so the initial UI uses identity, counts, and video titles only.
