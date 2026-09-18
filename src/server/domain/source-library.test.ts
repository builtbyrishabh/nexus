import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    returning: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);

  const insertQuery = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
  };
  insertQuery.values.mockReturnValue(insertQuery);

  return {
    query,
    insertQuery,
    db: {
      select: vi.fn(() => query),
      delete: vi.fn(() => query),
      insert: vi.fn(() => insertQuery),
      update: vi.fn(() => query),
    },
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));

const {
  attachSourceToUser,
  deriveAllowedCreators,
  listOwnedSources,
  loadSourceLibrary,
  removeOwnedSource,
} = await import(
  "~/server/domain/source-library"
);
const { userSource } = await import("~/server/db/schema");

describe("source library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.from.mockReturnValue(mocks.query);
    mocks.query.leftJoin.mockReturnValue(mocks.query);
    mocks.query.set.mockReturnValue(mocks.query);
    mocks.query.where.mockReturnValue(mocks.query);
    mocks.insertQuery.values.mockReturnValue(mocks.insertQuery);
  });

  it("lists the user's sources in newest-first query order", async () => {
    const owned = [
      {
        id: "source-1",
        title: "A useful video",
        url: "https://youtu.be/abcdefghijk",
        author: "Creator",
        creatorHandle: "creator",
        publishedAt: null,
        createdAt: new Date("2026-09-18T00:00:00Z"),
      },
    ];
    mocks.query.orderBy.mockResolvedValue(owned);

    await expect(listOwnedSources("user-1")).resolves.toEqual(owned);
    expect(mocks.query.leftJoin).toHaveBeenCalledOnce();
    expect(mocks.query.orderBy).toHaveBeenCalledOnce();
  });

  it("keeps independent memberships when two users attach the same source", async () => {
    mocks.insertQuery.onConflictDoNothing.mockResolvedValue(undefined);

    await attachSourceToUser("user-1", "source-1");
    await attachSourceToUser("user-2", "source-1");

    expect(mocks.insertQuery.values).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      sourceId: "source-1",
    });
    expect(mocks.insertQuery.values).toHaveBeenNthCalledWith(2, {
      userId: "user-2",
      sourceId: "source-1",
    });
    expect(mocks.db.insert).toHaveBeenCalledWith(userSource);
    expect(mocks.insertQuery.onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it("reports whether an owned source was actually removed", async () => {
    mocks.query.returning
      .mockResolvedValueOnce([{ id: "source-1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(removeOwnedSource("user-1", "source-1")).resolves.toBe(true);
    await expect(removeOwnedSource("user-2", "source-1")).resolves.toBe(false);
    expect(mocks.db.delete).toHaveBeenCalledWith(userSource);
    expect(mocks.db.update).toHaveBeenCalledTimes(2);
  });

  it("clears legacy direct ownership without deleting the canonical source", async () => {
    mocks.query.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sourceId: "source-1" }]);

    await expect(removeOwnedSource("user-1", "source-1")).resolves.toBe(true);
    expect(mocks.db.delete).toHaveBeenCalledWith(userSource);
  });

  it("derives one stable creator roster from owned sources", () => {
    expect(
      deriveAllowedCreators([
        { handle: "naval", displayName: null },
        { handle: "alex", displayName: "Alex Hormozi" },
        { handle: "naval", displayName: "Naval Ravikant" },
        { handle: null, displayName: "Unknown" },
        { handle: "alex", displayName: "Alex" },
      ]),
    ).toEqual([
      { handle: "alex", displayName: "Alex Hormozi" },
      { handle: "naval", displayName: "Naval Ravikant" },
    ]);
  });

  it("loads roster rows from the requested user's sources", async () => {
    mocks.query.where.mockResolvedValueOnce([
      { handle: "alex", displayName: "Alex Hormozi" },
    ]);

    await expect(loadSourceLibrary("user-1")).resolves.toEqual({
      hasSources: true,
      allowedCreators: [
        { handle: "alex", displayName: "Alex Hormozi" },
      ],
    });
    expect(mocks.db.select).toHaveBeenCalledOnce();
    expect(mocks.query.where).toHaveBeenCalledOnce();
  });

  it("keeps source ownership separate from creator tagging", async () => {
    mocks.query.where.mockResolvedValueOnce([
      { handle: null, displayName: "Unknown" },
    ]);

    await expect(loadSourceLibrary("user-1")).resolves.toEqual({
      hasSources: true,
      allowedCreators: [],
    });
  });
});
