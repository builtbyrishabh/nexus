import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);

  return {
    query,
    db: { select: vi.fn(() => query) },
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));

const { deriveAllowedCreators, groupLibrarySources, loadSourceLibrary } =
  await import("~/server/domain/source-library");

describe("source library", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("groups owned videos into creator cards", () => {
    expect(
      groupLibrarySources([
        {
          id: "video-2",
          title: "Second video",
          url: "https://youtube.com/watch?v=22222222222",
          author: "Creator Name",
          creatorHandle: "creator",
        },
        {
          id: "video-1",
          title: "First video",
          url: "https://youtube.com/watch?v=11111111111",
          author: "Creator",
          creatorHandle: "creator",
        },
        {
          id: "legacy",
          title: "Legacy source",
          url: "https://youtube.com/watch?v=33333333333",
          author: null,
          creatorHandle: null,
        },
      ]),
    ).toEqual([
      {
        handle: "creator",
        displayName: "Creator Name",
        videos: [
          {
            id: "video-2",
            title: "Second video",
            url: "https://youtube.com/watch?v=22222222222",
          },
          {
            id: "video-1",
            title: "First video",
            url: "https://youtube.com/watch?v=11111111111",
          },
        ],
      },
      {
        handle: null,
        displayName: "Other sources",
        videos: [
          {
            id: "legacy",
            title: "Legacy source",
            url: "https://youtube.com/watch?v=33333333333",
          },
        ],
      },
    ]);
  });

  it("loads roster rows from the requested user's sources", async () => {
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

  it("keeps source ownership separate from creator tagging", async () => {
    mocks.query.where.mockResolvedValue([
      { handle: null, displayName: "Unknown" },
    ]);

    await expect(loadSourceLibrary("user-1")).resolves.toEqual({
      hasSources: true,
      allowedCreators: [],
    });
  });
});
