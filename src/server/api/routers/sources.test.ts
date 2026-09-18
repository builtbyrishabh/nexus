import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";

const service = vi.hoisted(() => ({
  overview: vi.fn(),
}));

vi.mock("~/server/sources/source-management", () => ({
  getSourceOverview: service.overview,
}));

import { sourcesRouter } from "~/server/api/routers/sources";

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

  it("requires authentication", async () => {
    await expect(caller(null).overview()).rejects.toBeInstanceOf(TRPCError);
    expect(service.overview).not.toHaveBeenCalled();
  });
});
