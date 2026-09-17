import { describe, expect, it, vi } from "vitest";

import { IN_FLIGHT } from "~/server/ingest/channel";
import { settleImportItems } from "~/workflows/channel-import";

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    externalId: `video-${index}`,
  }));

describe("channel import orchestration", () => {
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
});
