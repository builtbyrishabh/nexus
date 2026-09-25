import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ SUPADATA_API_KEY: undefined as string | undefined }));
vi.mock("~/env", () => ({ env: mockEnv }));

const workflow = vi.hoisted(() => {
  const dispose = vi.fn();
  const getConflict = vi.fn();
  return {
    createHook: vi.fn(() => ({
      getConflict,
      [Symbol.dispose]: dispose,
    })),
    dispose,
    getConflict,
  };
});

vi.mock("workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("workflow")>()),
  createHook: workflow.createHook,
}));

import { IN_FLIGHT } from "~/server/ingest/channel";
import {
  runChannelImport,
  settleImportItems,
} from "~/workflows/channel-import";

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    externalId: `video-${index}`,
  }));

describe("channel import orchestration", () => {
  it("leaves an import to the active workflow when the same job is launched twice", async () => {
    workflow.getConflict.mockResolvedValueOnce({ runId: "active-run" });

    await expect(runChannelImport("job-1")).resolves.toBeUndefined();

    expect(workflow.createHook).toHaveBeenCalledWith({
      token: "channel-import:job-1",
    });
    expect(workflow.dispose).toHaveBeenCalledOnce();
  });

  it("keeps at most three videos in flight", async () => {
    let running = 0;
    let peak = 0;

    await settleImportItems(items(8), {
      process: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
      },
      fail: vi.fn(),
    });

    expect(peak).toBe(IN_FLIGHT);
  });

  it("processes one video at a time with Supadata's rate limit", async () => {
    mockEnv.SUPADATA_API_KEY = "test-key";
    let running = 0;
    let peak = 0;
    try {
      await settleImportItems(items(4), {
        process: async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
        },
        fail: vi.fn(),
      });
      expect(peak).toBe(1);
    } finally {
      mockEnv.SUPADATA_API_KEY = undefined;
    }
  });

  it("records one failure and continues later batches", async () => {
    const processed: string[] = [];
    const fail = vi.fn();

    await settleImportItems(items(5), {
      process: async (item) => {
        processed.push(item.id);
        if (item.id === "item-1") throw new Error("private video");
      },
      fail,
    });

    expect(processed).toEqual(items(5).map((item) => item.id));
    expect(fail).toHaveBeenCalledWith("item-1", "private video");
  });

  it("waits for every started video before surfacing a failure-recording error", async () => {
    let siblingFinished = false;

    const result = settleImportItems(items(2), {
      process: async (item) => {
        if (item.id === "item-0") throw new Error("private video");
        await new Promise((resolve) => setTimeout(resolve, 5));
        siblingFinished = true;
      },
      fail: async () => {
        throw new Error("could not record failure");
      },
    });

    await expect(result).rejects.toThrow("could not record failure");
    expect(siblingFinished).toBe(true);
  });
});
