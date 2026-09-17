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

/** A reference a loader can load — e.g. one video in a channel. Identity only, on purpose. */
export type SourceRef = {
  kind: SourceKind;
  externalId: string;
};

/**
 * Anything that names a channel: handle, UC id, channel URL, or a video (id/URL) that resolves
 * to its owner. Opaque to the pipeline; the loader interprets it.
 */
export type ChannelScope = string;

/** Where a transcript came from. An STT transcript is final — re-runs never redo it. */
export type Provenance = "captions" | "stt";

/** Which speech-to-text service produced an `stt` transcript. A code-level choice, not a knob. */
export type SttProvider = "assemblyai";

/**
 * Where a transcript came from, persisted as `source.metadata` (jsonb; no migration) so the
 * provenance gate can read it on the next run without touching the network.
 */
export type SourceProvenance = {
  provenance: Provenance;
  sttProvider?: SttProvider;
};

/** The expensive thing a loader fetches. Drives the content hash. */
export type Transcript = SourceProvenance & {
  segments: Segment[];
};

/**
 * The ingestion seam. `ingestSource(ref, loader)` never names a source kind: it asks for the
 * transcript first (to run the skip gates), and for metadata only once it has decided to write.
 */
export interface SourceLoader {
  /** Every upload the scope belongs to, newest first, streamed page by page. */
  discover(scope: ChannelScope, opts?: { limit?: number }): AsyncIterable<SourceRef>;
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
  /** Exact central chunk that the citation timestamp points to. */
  excerpt: string;
  /** Central chunk widened with neighbors for retrieval and answer generation. */
  text: string;
  /**
   * The Contextual-Retrieval blurb: who is speaking, about what, in which video. The raw
   * transcript says "he", "the practice", "this" — the blurb names them. It rides with the
   * evidence so the generator can tie a question's entity ("Smile Match") to a chunk that
   * never says the name; measured: without it the model wrongly refuses ~25% of such questions.
   */
  context?: string;
  score: number;
  locator?: Locator;
  source: { title: string; url: string; author: string | null };
};
