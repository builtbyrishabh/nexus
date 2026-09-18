import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/imports/channel-import", () => ({
  listChannelImports: vi.fn(),
}));

const { groupLibrarySources } = await import(
  "~/server/sources/source-management"
);

describe("source management library projection", () => {
  it("groups only owned rows into stable creator cards", () => {
    const newer = new Date("2026-09-17T10:00:00Z");
    const older = new Date("2026-09-16T10:00:00Z");

    expect(
      groupLibrarySources([
        {
          id: "video-2",
          title: "Second video",
          url: "https://youtube.com/watch?v=22222222222",
          author: "Creator Name",
          creatorHandle: "creator",
          publishedAt: newer,
          addedAt: newer,
        },
        {
          id: "video-1",
          title: "First video",
          url: "https://youtube.com/watch?v=11111111111",
          author: "Creator",
          creatorHandle: "creator",
          publishedAt: older,
          addedAt: older,
        },
        {
          id: "legacy",
          title: "Legacy source",
          url: "https://youtube.com/watch?v=33333333333",
          author: null,
          creatorHandle: null,
          publishedAt: null,
          addedAt: older,
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
            publishedAt: newer,
            addedAt: newer,
          },
          {
            id: "video-1",
            title: "First video",
            url: "https://youtube.com/watch?v=11111111111",
            publishedAt: older,
            addedAt: older,
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
            publishedAt: null,
            addedAt: older,
          },
        ],
      },
    ]);
  });
});
