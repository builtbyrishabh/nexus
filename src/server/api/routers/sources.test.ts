import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";

const service = vi.hoisted(() => ({
  creators: vi.fn(),
  imports: vi.fn(),
}));

vi.mock("~/server/domain/source-library", () => ({
  listLibraryCreators: service.creators,
}));
vi.mock("~/server/imports/channel-import", () => ({
  listChannelImports: service.imports,
}));

import { sourcesRouter } from "~/server/api/routers/sources";

const caller = (userId: string | null) =>
  sourcesRouter.createCaller({ db, userId, headers: new Headers() });

describe("sources router ownership boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the overview through the authenticated owner", async () => {
    service.creators.mockResolvedValue([]);
    service.imports.mockResolvedValue([]);

    await expect(caller("user-a").overview()).resolves.toEqual({
      creators: [],
      imports: [],
    });
    expect(service.creators).toHaveBeenCalledWith("user-a");
    expect(service.imports).toHaveBeenCalledWith("user-a");
  });

  it("requires authentication", async () => {
    await expect(caller(null).overview()).rejects.toBeInstanceOf(TRPCError);
    expect(service.creators).not.toHaveBeenCalled();
    expect(service.imports).not.toHaveBeenCalled();
  });
});
