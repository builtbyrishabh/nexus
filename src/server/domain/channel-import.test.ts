import { describe, expect, it } from "vitest";

import {
  canRetryImport,
  importErrorMessage,
  summarizeImport,
} from "~/server/domain/channel-import";

describe("channel import summary", () => {
  it("derives every count from item state", () => {
    const statuses = [
      "queued",
      "processing",
      "ingested",
      "ingested",
      "skipped",
      "failed",
    ] as const;

    expect(summarizeImport(statuses.map((status) => ({ status })))).toEqual({
      discovered: 6,
      queued: 1,
      processing: 1,
      ingested: 2,
      skipped: 1,
      failed: 1,
    });
  });

  it("reports an undiscovered job as all zeroes", () => {
    expect(summarizeImport([])).toEqual({
      discovered: 0,
      queued: 0,
      processing: 0,
      ingested: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe("channel import retry transition", () => {
  it("retries only terminal work that can make progress", () => {
    expect(canRetryImport("queued", 1)).toBe(false);
    expect(canRetryImport("discovering", 1)).toBe(false);
    expect(canRetryImport("processing", 1)).toBe(false);
    expect(canRetryImport("completed", 0)).toBe(false);
    expect(canRetryImport("completed", 1)).toBe(true);
    expect(canRetryImport("failed", 0)).toBe(true);
  });
});

describe("importErrorMessage", () => {
  it("normalizes unknown failures without persisting stacks", () => {
    expect(importErrorMessage(new Error("provider unavailable"))).toBe(
      "provider unavailable",
    );
    expect(importErrorMessage(null)).toBe("null");
    expect(importErrorMessage(" ")).toBe("Unknown import error");
  });

  it("bounds persisted provider messages", () => {
    expect(importErrorMessage("x".repeat(1_001))).toHaveLength(1_000);
  });
});
