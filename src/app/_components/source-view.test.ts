import { describe, expect, it } from "vitest";

import {
  importStatusLabel,
  isActiveImport,
  type ImportOverview,
} from "~/app/_components/source-view";

function job(
  status: ImportOverview["status"],
  summary: ImportOverview["summary"],
): ImportOverview {
  return {
    id: "00000000-0000-4000-8000-000000000033",
    scope: "UC123",
    creatorHandle: "creator",
    status,
    error: null,
    createdAt: new Date("2026-09-17T10:00:00Z"),
    updatedAt: new Date("2026-09-17T10:01:00Z"),
    summary,
  };
}

const partialSummary = {
  discovered: 50,
  queued: 4,
  processing: 2,
  ingested: 35,
  skipped: 6,
  failed: 3,
};

describe("source import view states", () => {
  it("keeps polling only for non-terminal states", () => {
    expect(isActiveImport("queued")).toBe(true);
    expect(isActiveImport("discovering")).toBe(true);
    expect(isActiveImport("processing")).toBe(true);
    expect(isActiveImport("completed")).toBe(false);
    expect(isActiveImport("failed")).toBe(false);
  });

  it("surfaces partial success without adding a database state", () => {
    expect(importStatusLabel(job("completed", partialSummary))).toBe(
      "Completed with failures",
    );
    expect(
      importStatusLabel(
        job("completed", { ...partialSummary, failed: 0, queued: 0 }),
      ),
    ).toBe("Completed");
  });
});
