import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updates: Array<Record<string, unknown>> = [];
  let rejectRunIdWrite = false;
  const itemsQuery = {
    from: vi.fn(),
    where: vi.fn(),
  };
  itemsQuery.from.mockReturnValue(itemsQuery);

  const db = {
    query: {
      channelImport: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => itemsQuery),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          if (rejectRunIdWrite && "workflowRunId" in values) {
            throw new Error("database unavailable");
          }
        },
      }),
    })),
  };

  return {
    db,
    discover: vi.fn(),
    itemsQuery,
    start: vi.fn(),
    updates,
    setRejectRunIdWrite(value: boolean) {
      rejectRunIdWrite = value;
    },
  };
});

vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("~/server/ingest/youtube-loader", () => ({
  discoverYoutubeChannel: mocks.discover,
}));

const { launchChannelImport, listChannelImports, previewChannelImport } =
  await import("~/server/imports/channel-import");

describe("channel import launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.setRejectRunIdWrite(false);
    mocks.itemsQuery.from.mockReturnValue(mocks.itemsQuery);
  });

  it("previews the canonical channel without starting an import", async () => {
    mocks.discover.mockResolvedValue({
      channelId: "UC123",
      creatorHandle: "creator",
      displayName: "Creator Name",
      refs: [{ kind: "youtube_video", externalId: "abcdefghijk" }],
    });

    await expect(previewChannelImport(" @Creator ")).resolves.toEqual({
      channelId: "UC123",
      creatorHandle: "creator",
      displayName: "Creator Name",
      importLimit: 50,
    });
    expect(mocks.discover).toHaveBeenCalledWith("@Creator", 1);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("lists recent owned jobs with summaries derived from their items", async () => {
    const createdAt = new Date("2026-09-18T00:00:00Z");
    mocks.db.query.channelImport.findMany
      .mockResolvedValueOnce([
        {
          id: "job-1",
          scope: "@creator",
          status: "processing",
          creatorHandle: "creator",
          error: null,
          createdAt,
          startedAt: createdAt,
          finishedAt: null,
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.itemsQuery.where.mockResolvedValue([
      { jobId: "job-1", status: "ingested" },
      { jobId: "job-1", status: "processing" },
    ]);

    await expect(listChannelImports("user-1")).resolves.toEqual([
      {
        id: "job-1",
        scope: "@creator",
        status: "processing",
        creatorHandle: "creator",
        error: null,
        createdAt,
        startedAt: createdAt,
        finishedAt: null,
        summary: {
          discovered: 2,
          queued: 0,
          processing: 1,
          ingested: 1,
          skipped: 0,
          failed: 0,
        },
      },
    ]);
  });

  it("does not mark an accepted workflow failed when saving its diagnostic run ID fails", async () => {
    mocks.start.mockResolvedValue({ runId: "run-1" });
    mocks.setRejectRunIdWrite(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(launchChannelImport("job-1")).resolves.toBeUndefined();

    expect(mocks.updates).toEqual([{ workflowRunId: "run-1" }]);
    log.mockRestore();
  });

  it("marks the job failed when the workflow was not enqueued", async () => {
    mocks.start.mockRejectedValue(new Error("queue unavailable"));

    await expect(launchChannelImport("job-1")).rejects.toThrow(
      "queue unavailable",
    );

    expect(mocks.updates).toEqual([
      expect.objectContaining({ status: "failed", error: "queue unavailable" }),
    ]);
  });
});
