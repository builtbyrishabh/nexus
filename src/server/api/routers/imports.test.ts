import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";

const service = vi.hoisted(() => ({
  get: vi.fn(),
  retry: vi.fn(),
  start: vi.fn(),
}));

vi.mock("~/server/imports/channel-import", () => ({
  getChannelImport: service.get,
  retryFailedChannelImport: service.retry,
  startChannelImport: service.start,
  ImportNotFoundError: class ImportNotFoundError extends Error {},
  ImportNotRetryableError: class ImportNotRetryableError extends Error {},
}));

import { importsRouter } from "~/server/api/routers/imports";
import {
  ImportNotFoundError,
  ImportNotRetryableError,
} from "~/server/imports/channel-import";

const jobId = "00000000-0000-4000-8000-000000000032";
const caller = (userId: string | null) =>
  importsRouter.createCaller({ db, userId, headers: new Headers() });

describe("imports router ownership boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes ownership from the authenticated context", async () => {
    service.start.mockResolvedValue({ jobId });

    await expect(caller("user-a").start({ scope: " @creator " })).resolves.toEqual({
      jobId,
    });
    expect(service.start).toHaveBeenCalledWith("user-a", "@creator");
  });

  it("never exposes a job absent from the caller's owned lookup", async () => {
    service.get.mockResolvedValue(undefined);

    await expect(caller("user-b").byId({ jobId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(service.get).toHaveBeenCalledWith("user-b", jobId);
  });

  it("passes the authenticated owner to retries", async () => {
    service.retry.mockResolvedValue({ jobId });

    await expect(caller("user-a").retryFailures({ jobId })).resolves.toEqual({
      jobId,
    });
    expect(service.retry).toHaveBeenCalledWith("user-a", jobId);
  });

  it("rejects an unowned or active retry without exposing job details", async () => {
    service.retry.mockRejectedValue(new ImportNotFoundError());

    await expect(caller("user-b").retryFailures({ jobId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects retries while the owned job is active", async () => {
    service.retry.mockRejectedValue(new ImportNotRetryableError());

    await expect(caller("user-a").retryFailures({ jobId })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("requires authentication", async () => {
    await expect(caller(null).byId({ jobId })).rejects.toBeInstanceOf(TRPCError);
    expect(service.get).not.toHaveBeenCalled();
  });
});
