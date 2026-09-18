import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  embedQuery: vi.fn(),
  rerankDocuments: vi.fn(),
}));

vi.mock("~/server/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("~/server/ingest/embed", () => ({ embedQuery: mocks.embedQuery }));
vi.mock("~/server/retrieval/rerank", () => ({
  rerankDocuments: mocks.rerankDocuments,
}));

const { retrieve } = await import("~/server/retrieval/retrieve");

describe("retrieval source-library scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embedQuery.mockResolvedValue([0.1, 0.2]);
    mocks.execute.mockResolvedValue([]);
    mocks.rerankDocuments.mockResolvedValue([]);
  });

  it("filters dense and sparse candidates by source owner and creator before ranking", async () => {
    await retrieve("pricing advice", {
      userId: "user-1",
      creatorHandle: "alex",
    });

    const dialect = new PgDialect();
    const queries = mocks.execute.mock.calls.map(([query]) =>
      dialect.sqlToQuery(query as SQL),
    );

    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).not.toContain('"Nexus_user_source"');
      expect(query.sql).toContain("s.user_id =");
      expect(query.sql).toContain("s.creator_handle =");
      expect(query.params).toContain("user-1");
      expect(query.params).toContain("alex");
    }
  });
});
