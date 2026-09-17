# Source management UI

## Problem

The product can scope retrieval to a user's `user_source` memberships and can run durable channel imports, but those capabilities have no user-facing surface. A user cannot inspect their library, resolve a YouTube input before importing it, recover job progress after a refresh, retry failures, or remove a creator.

## Usage

The Sources page uses one protected overview query and focused mutations:

```ts
const overview = await api.sources.overview.query();
const preview = await api.sources.preview.mutate({ scope: "@creator" });
const { jobId } = await api.imports.start.mutate({ scope: preview.channelId });
const job = await api.imports.byId.query({ jobId });
await api.imports.retryFailures.mutate({ jobId });
await api.sources.removeCreator.mutate({ creatorHandle: preview.creatorHandle });
```

`overview` returns a bounded list of recent import summaries and every source reached through the current user's memberships. The browser polls that single snapshot only while an import is active. Video-level outcomes stay behind `imports.byId` and are loaded when a user expands a job.

## Shape

- `sources.overview`: groups `user_source → source` rows into creator cards and combines them with the latest 20 owned import summaries.
- `sources.preview`: resolves every supported YouTube input to canonical channel identity without discovering videos.
- `imports.start`: resolves the submitted channel before persistence so active jobs have canonical creator identity from creation onward.
- `sources.removeCreator`: rejects removal while a matching import is active, then deletes only the user's memberships. Shared sources, transcripts, chunks, and embeddings remain untouched.
- `/sources`: owns preview/confirmation state and renders empty, loading, active, partial-success, failed, completed, and removal states.
- The existing shell uses the full sidebar on desktop and a compact Chats/Sources navigation on mobile.

The import limit lives in the domain module so the preview and workflow use the same value. `completed_with_failures` remains a display state derived from a completed job with failed items; it is not a second persistence state.

## Synthesis decision

The chosen design uses one page-shaped overview read model with resource-specific mutations. This keeps browser polling and cache coordination small while preserving the existing import API as the owner of import behavior. A competing design exposed separate library and import list queries; it was rejected because the browser would have to synchronize two independently refreshing snapshots for no product benefit.

The overview is deliberately bounded on the import side and does not persist a new frontend source model. `user_source` remains the sole searchable-library truth.

## Tradeoffs

- Channel resolution runs again when an import is confirmed. This avoids trusting preview data from the browser and keeps the start endpoint correct when called directly.
- Removal is blocked during an active matching import instead of introducing cancellation or tombstone infrastructure.
- The library has no stored channel avatar, so the initial UI uses identity, counts, and video titles only.
