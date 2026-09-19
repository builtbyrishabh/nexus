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

const {
  combineImportHistory,
  launchChannelImport,
  listChannelImports,
  previewChannelImport,
} = await import("~/server/imports/channel-import");

const historyJobs = (count: number, start = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: `job-${start + index}`,
    createdAt: new Date(Date.UTC(2026, 8, 18, 0, 0, count - index)),
  }));

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

  it("returns an empty import history without querying item summaries", () => {
    expect(combineImportHistory([], [])).toEqual([]);
  });

  it("keeps exactly 20 terminal imports", () => {
    expect(combineImportHistory([], historyJobs(20))).toHaveLength(20);
  });

  it("caps terminal imports at 20 and merges active jobs newest-first", () => {
    const terminal = historyJobs(21);
    const active = [
      { id: "active", createdAt: new Date("2026-09-18T00:01:00Z") },
    ];

    const history = combineImportHistory(active, terminal);

    expect(history).toHaveLength(21);
    expect(history[0]?.id).toBe("active");
    expect(history.some((job) => job.id === "job-20")).toBe(false);
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
