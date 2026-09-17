import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);

  return {
    query,
    db: { select: vi.fn(() => query) },
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));

const { deriveAllowedCreators, loadSourceLibrary } = await import(
  "~/server/domain/source-library"
);

describe("source library", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives one stable creator roster from member sources", () => {
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

  it("loads roster rows through the requested user's memberships", async () => {
    mocks.query.where.mockResolvedValue([
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

  it("keeps membership separate from creator tagging", async () => {
    mocks.query.where.mockResolvedValue([
      { handle: null, displayName: "Unknown" },
    ]);

    await expect(loadSourceLibrary("user-1")).resolves.toEqual({
      hasSources: true,
      allowedCreators: [],
    });
  });
});
