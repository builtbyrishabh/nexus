import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";

const service = vi.hoisted(() => ({
  overview: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("~/server/sources/source-management", () => ({
  getSourceOverview: service.overview,
  previewYoutubeSource: service.preview,
  removeLibraryCreator: service.remove,
  SourceRemovalConflictError: class SourceRemovalConflictError extends Error {},
}));

import { sourcesRouter } from "~/server/api/routers/sources";
import { SourceRemovalConflictError } from "~/server/sources/source-management";

const caller = (userId: string | null) =>
  sourcesRouter.createCaller({ db, userId, headers: new Headers() });

describe("sources router ownership boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the overview through the authenticated owner", async () => {
    service.overview.mockResolvedValue({ creators: [], imports: [] });

    await expect(caller("user-a").overview()).resolves.toEqual({
      creators: [],
      imports: [],
    });
    expect(service.overview).toHaveBeenCalledWith("user-a");
  });

  it("resolves a trimmed scope without accepting an owner from the browser", async () => {
    service.preview.mockResolvedValue({
      channelId: "UC123",
      creatorHandle: "creator",
      displayName: "Creator",
      importLimit: 50,
    });

    await caller("user-a").preview({ scope: " @creator " });
    expect(service.preview).toHaveBeenCalledWith("@creator");
  });

  it("maps provider resolution failures to a safe invalid-input error", async () => {
    service.preview.mockRejectedValue(new Error("provider internals"));

    await expect(
      caller("user-a").preview({ scope: "not-a-channel" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("removes only through the authenticated owner", async () => {
    service.remove.mockResolvedValue({ removed: 12 });

    await expect(
      caller("user-a").removeCreator({ creatorHandle: "creator" }),
    ).resolves.toEqual({ removed: 12 });
    expect(service.remove).toHaveBeenCalledWith("user-a", "creator");
  });

  it("rejects removal while a matching import can reattach videos", async () => {
    service.remove.mockRejectedValue(
      new SourceRemovalConflictError("Import still active"),
    );

    await expect(
      caller("user-a").removeCreator({ creatorHandle: "creator" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("requires authentication", async () => {
    await expect(caller(null).overview()).rejects.toBeInstanceOf(TRPCError);
    expect(service.overview).not.toHaveBeenCalled();
  });
});
