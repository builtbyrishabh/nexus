import { describe, expect, it } from "vitest";

import { combineImportHistory } from "~/server/imports/channel-import";

describe("channel import history", () => {
  it("keeps active imports visible beyond the recent completed history", () => {
    const active = {
      id: "active",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    };
    const recent = Array.from({ length: 20 }, (_, index) => ({
      id: `completed-${index}`,
      createdAt: new Date(`2026-09-${String(index + 2).padStart(2, "0")}T00:00:00Z`),
    }));

    expect(combineImportHistory([active], recent)).toContain(active);
    expect(combineImportHistory([active], recent)).toHaveLength(21);
  });
});
