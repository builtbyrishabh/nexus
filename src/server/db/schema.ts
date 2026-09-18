import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTableCreator,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Multi-project schema: every table is prefixed so this database can be shared.
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `Nexus_${name}`);

/** Postgres full-text search vector. Drizzle has no native builder, so we declare one. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const sourceKind = pgEnum("nexus_source_kind", [
  "youtube_video",
  "book",
]);

export const channelImportStatus = pgEnum("nexus_channel_import_status", [
  "queued",
  "discovering",
  "processing",
  "completed",
  "failed",
]);

export const channelImportItemStatus = pgEnum(
  "nexus_channel_import_item_status",
  ["queued", "processing", "ingested", "skipped", "failed"],
);

/**
 * `source` — one ingested thing (a YouTube video now, a book later). Provenance/catalog:
 * what a citation points back to, and the idempotency anchor for re-ingestion.
 */
export const source = createTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Read-only compatibility for catalogs created before user_source was restored.
    // New ownership writes go exclusively to userSource.
    userId: text("user_id"),
    kind: sourceKind("kind").notNull().default("youtube_video"),
    externalId: text("external_id").notNull(), // videoId; unique per kind
    title: text("title").notNull(),
    url: text("url").notNull(),
    author: text("author"), // channel name (free-text, as the platform reports it)
    // Stable creator slug retained as source metadata. Chat retrieval currently searches the
    // complete ingested catalog.
    creatorHandle: text("creator_handle"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    contentHash: text("content_hash").notNull(), // idempotent re-ingest
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (t) => [
    index("source_user_idx").on(t.userId),
    uniqueIndex("source_kind_external_idx").on(t.kind, t.externalId),
    // Retrieval filters by creator scope; index the scope column.
    index("source_creator_idx").on(t.creatorHandle),
  ],
);

/** Which canonical sources an authenticated Clerk user may search. */
export const userSource = createTable(
  "user_source",
  {
    userId: text("user_id").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceId] })],
);

/** One authenticated request to import the latest uploads from a YouTube channel. */
export const channelImport = createTable(
  "channel_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    scope: text("scope").notNull(),
    status: channelImportStatus("status").notNull().default("queued"),
    creatorHandle: text("creator_handle"),
    workflowRunId: text("workflow_run_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("channel_import_user_created_idx").on(t.userId, t.createdAt)],
);

/** The exact discovered videos and their independently retryable outcomes. */
export const channelImportItem = createTable(
  "channel_import_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => channelImport.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    position: integer("position").notNull(),
    status: channelImportItemStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    sourceId: uuid("source_id").references(() => source.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    skipReason: text("skip_reason"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("channel_import_item_job_video_idx").on(t.jobId, t.externalId),
    uniqueIndex("channel_import_item_job_position_idx").on(t.jobId, t.position),
    index("channel_import_item_job_status_idx").on(t.jobId, t.status),
  ],
);

/**
 * `chunk` — the retrievable unit. One timestamped slice of a transcript: what retrieval
 * searches and what the model reads. `context_text` holds the Contextual-Retrieval blurb;
 * `embedding` is embed(context_text + text); `tsv` indexes the same for sparse search.
 */
export const chunk = createTable(
  "chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(), // ordinal within source
    text: text("text").notNull(), // raw verbatim transcript: display + lexical
    contextText: text("context_text").notNull().default(""), // Slice 1 blurb
    embedding: vector("embedding", { dimensions: 1536 }).notNull(), // embed(context_text + "\n" + text)
    // Sparse index, generated in-DB from context_text + text, queried by sparse retrieval.
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(context_text, '') || ' ' || text)`,
    ),
    startSec: integer("start_sec"), // Locator → [mm:ss] deep-link
    endSec: integer("end_sec"),
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("chunk_embedding_hnsw_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("chunk_tsv_gin_idx").using("gin", t.tsv),
    index("chunk_source_order_idx").on(t.sourceId, t.chunkIndex),
  ],
);

export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
export type UserSource = typeof userSource.$inferSelect;
export type NewUserSource = typeof userSource.$inferInsert;
export type ChannelImport = typeof channelImport.$inferSelect;
export type NewChannelImport = typeof channelImport.$inferInsert;
export type ChannelImportItem = typeof channelImportItem.$inferSelect;
export type NewChannelImportItem = typeof channelImportItem.$inferInsert;
export type Chunk = typeof chunk.$inferSelect;
export type NewChunk = typeof chunk.$inferInsert;
