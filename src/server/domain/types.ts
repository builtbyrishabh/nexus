/**
 * Nexus domain vocabulary. These are the load-bearing names from docs/DESIGN.md.
 * Everything is named against these terms — no `doc`/`result`/`hit` synonyms.
 */

export type SourceKind = "youtube_video" | "book";

/** A raw transcript span from a loader, pre-chunk. */
export type Segment = {
  text: string;
  startSec?: number;
  endSec?: number;
};

/** Source metadata a loader resolves (title, url, author...). */
export type SourceMeta = {
  kind: SourceKind;
  externalId: string;
  title: string;
  url: string;
  author?: string;
  publishedAt?: Date;
};

/** A reference a loader can load — e.g. one video in a channel. */
export type SourceRef = {
  kind: SourceKind;
  externalId: string;
};

/** Where a transcript came from. Persisted on the source row: it drives idempotency (a Whisper
 * transcript is never re-fetched — the audio doesn't change) and is useful provenance on its own. */
export type TranscriptProvenance = "captions" | "whisper";

/** A source's raw timestamped segments plus where they came from. */
export type Transcript = {
  segments: Segment[];
  provenance: TranscriptProvenance;
};

/**
 * The ingestion seam (docs/DESIGN.md §4a). Source-agnostic on purpose: books are a new loader
 * behind this same shape, not a change to the orchestrator. `discover` enumerates a scope (a
 * channel today); `loadTranscript` is the expensive call that drives the idempotency hash;
 * `loadMeta` is fetched only once the pipeline has decided to write.
 */
export interface SourceLoader {
  discover(scope: string, opts?: { limit?: number }): AsyncIterable<SourceRef>;
  loadTranscript(ref: SourceRef): Promise<Transcript>;
  loadMeta(ref: SourceRef): Promise<SourceMeta>;
}

/** Where in the source — powers deep-links. */
export type Locator = {
  startSec: number;
  endSec: number;
};

/** A retrieved + ranked Chunk the model reads. */
export type Evidence = {
  chunkId: string;
  sourceId: string;
  text: string;
  score: number;
  locator?: Locator;
  source: { title: string; url: string };
};

export type Filter = {
  sourceIds?: string[];
  kind?: SourceKind;
};

/** What the user sees for one inline [n] marker. */
export type Citation = {
  sourceTitle: string;
  url: string;
  startSec?: number;
  timestamp?: string; // "12:04"
  deepLink?: string; // https://youtu.be/<id>?t=724
};

/** A deduped source card (one per video). */
export type SourceCard = {
  sourceId: string;
  title: string;
  url: string;
};

/** One message into the single entrypoint. */
export type Ask = {
  query: string;
  channel: "web" | "discord" | "telegram";
  userId: string;
  threadId: string;
};

/** One streamed chunk out of `ask()` (locked contract). */
export type AskChunk = {
  textDelta?: string;
  citations?: Citation[];
  sources?: SourceCard[];
};
