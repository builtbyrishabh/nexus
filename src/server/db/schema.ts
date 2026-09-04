import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTableCreator,
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

/**
 * `source` — one ingested thing (a YouTube video now, a book later). Provenance/catalog:
 * what a citation points back to, and the idempotency anchor for re-ingestion.
 */
export const source = createTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: sourceKind("kind").notNull().default("youtube_video"),
    externalId: text("external_id").notNull(), // videoId; unique per kind
    title: text("title").notNull(),
    url: text("url").notNull(),
    author: text("author"), // channel name
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
  (t) => [uniqueIndex("source_kind_external_idx").on(t.kind, t.externalId)],
);

/**
 * `chunk` — the retrievable unit. One timestamped slice of a transcript: what retrieval
 * searches and what the model reads. Slice 0 reads a narrow subset (text, embedding,
 * start/end sec); `context_text` and `tsv` are populated but idle until Slice 1.
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
    // Sparse index, generated in-DB from context_text + text. Idle in Slice 0.
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
export type Chunk = typeof chunk.$inferSelect;
export type NewChunk = typeof chunk.$inferInsert;
