import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";

const service = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  retry: vi.fn(),
  start: vi.fn(),
}));
const library = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));
const quota = vi.hoisted(() => ({ consume: vi.fn() }));

vi.mock("~/server/imports/channel-import", () => ({
  getChannelImport: service.get,
  listChannelImports: service.list,
  previewChannelImport: service.preview,
  retryFailedChannelImport: service.retry,
  startChannelImport: service.start,
  ImportNotFoundError: class ImportNotFoundError extends Error {},
  ImportNotRetryableError: class ImportNotRetryableError extends Error {},
}));
vi.mock("~/server/domain/source-library", () => ({
  listOwnedSources: library.list,
  removeOwnedSource: library.remove,
}));
vi.mock("~/server/usage-quota", () => ({ consumeDailyQuota: quota.consume }));

import { importsRouter } from "~/server/api/routers/imports";
const jobId = "00000000-0000-4000-8000-000000000032";
const retryableJob = {
  id: jobId,
  status: "failed",
  summary: { failed: 1 },
};
const caller = (userId: string | null) =>
  importsRouter.createCaller({ db, userId, headers: new Headers() });

describe("imports router ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quota.consume.mockResolvedValue(true);
  });

  it("previews a trimmed scope before starting work", async () => {
    service.preview.mockResolvedValue({
      channelId: "UC123",
      creatorHandle: "creator",
      displayName: "Creator",
      importLimit: 50,
    });

    await expect(caller("user-a").preview({ scope: " @creator " })).resolves.toMatchObject({
      channelId: "UC123",
    });
    expect(service.preview).toHaveBeenCalledWith("@creator");
  });

  it("loads only the authenticated user's jobs and sources", async () => {
    service.list.mockResolvedValue([]);
    library.list.mockResolvedValue([]);

    await expect(caller("user-a").list()).resolves.toEqual([]);
    await expect(caller("user-a").sources()).resolves.toEqual([]);
    expect(service.list).toHaveBeenCalledWith("user-a");
    expect(library.list).toHaveBeenCalledWith("user-a");
  });

  it("removes a source only through the authenticated owner", async () => {
    library.remove.mockResolvedValue(true);

    await expect(
      caller("user-a").removeSource({
        sourceId: "00000000-0000-4000-8000-000000000031",
      }),
    ).resolves.toEqual({ removed: true });
    expect(library.remove).toHaveBeenCalledWith(
      "user-a",
      "00000000-0000-4000-8000-000000000031",
    );
  });

  it("does not expose whether another user's source exists", async () => {
    library.remove.mockResolvedValue(false);

    await expect(
      caller("user-b").removeSource({
        sourceId: "00000000-0000-4000-8000-000000000031",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes ownership from the authenticated context", async () => {
    service.start.mockResolvedValue({ jobId });

    await expect(caller("user-a").start({ scope: " @creator " })).resolves.toEqual({
      jobId,
    });
    expect(service.start).toHaveBeenCalledWith("user-a", "@creator");
  });

  it("rejects import work after the daily quota without starting it", async () => {
    quota.consume.mockResolvedValue(false);

    await expect(caller("user-a").start({ scope: "@creator" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(service.start).not.toHaveBeenCalled();
  });

  it("never exposes a job absent from the caller's owned lookup", async () => {
    service.get.mockResolvedValue(undefined);

    await expect(caller("user-b").byId({ jobId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(service.get).toHaveBeenCalledWith("user-b", jobId);
  });

  it("passes the authenticated owner to retries", async () => {
    service.get.mockResolvedValue(retryableJob);
    service.retry.mockResolvedValue({ jobId });

    await expect(caller("user-a").retryFailures({ jobId })).resolves.toEqual({
      jobId,
    });
    expect(service.retry).toHaveBeenCalledWith("user-a", jobId);
  });

  it("does not retry after the daily import quota is exhausted", async () => {
    service.get.mockResolvedValue(retryableJob);
    quota.consume.mockResolvedValue(false);

    await expect(caller("user-a").retryFailures({ jobId })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(service.retry).not.toHaveBeenCalled();
  });

  it("rejects an unowned or active retry without exposing job details", async () => {
    service.get.mockResolvedValue(undefined);

    await expect(caller("user-b").retryFailures({ jobId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it("rejects retries while the owned job is active", async () => {
    service.get.mockResolvedValue({
      ...retryableJob,
      status: "processing",
    });

    await expect(caller("user-a").retryFailures({ jobId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(quota.consume).not.toHaveBeenCalled();
    expect(service.retry).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    await expect(caller(null).byId({ jobId })).rejects.toBeInstanceOf(TRPCError);
    expect(service.get).not.toHaveBeenCalled();
  });
});
