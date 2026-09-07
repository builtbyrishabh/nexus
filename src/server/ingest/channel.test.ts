import { describe, expect, it } from "vitest";

import type { SourceLoader, SourceRef } from "~/server/domain/types";
import { IN_FLIGHT, ingestChannel, summarize } from "~/server/ingest/channel";
import type { IngestResult } from "~/server/ingest/pipeline";

const ref = (id: string): SourceRef => ({ kind: "youtube_video", externalId: id });

const loaderOf = (ids: string[]): SourceLoader => ({
  async *discover(_scope, { limit } = {}) {
    for (const id of ids.slice(0, limit)) yield ref(id);
  },
  loadTranscript: () => Promise.reject(new Error("not used")),
  loadMeta: () => Promise.reject(new Error("not used")),
});

const ingestedResult = (r: SourceRef): IngestResult => ({
  status: "ingested",
  ref: r,
  sourceId: `src-${r.externalId}`,
  title: r.externalId,
  chunks: 1,
});

describe("ingestChannel — per-video isolation, discovery order", () => {
  it("records a failed video and keeps going", async () => {
    const outcomes = await ingestChannel("@x", {
      loader: loaderOf(["a", "b", "c"]),
      ingest: async (r) => {
        if (r.externalId === "b") throw new Error("boom");
        return ingestedResult(r);
      },
    });
    expect(outcomes.map((o) => o.status)).toEqual(["ingested", "failed", "ingested"]);
    const failed = outcomes[1]!;
    expect(failed.status === "failed" && (failed.error as Error).message).toBe("boom");
  });

  it("returns outcomes in discovery order even when later videos finish first", async () => {
    const outcomes = await ingestChannel("@x", {
      loader: loaderOf(["slow", "fast"]),
      ingest: async (r) => {
        await new Promise((res) => setTimeout(res, r.externalId === "slow" ? 30 : 0));
        return ingestedResult(r);
      },
    });
    expect(outcomes.map((o) => o.ref.externalId)).toEqual(["slow", "fast"]);
  });

  it("never has more than IN_FLIGHT videos running at once", async () => {
    let running = 0;
    let peak = 0;
    await ingestChannel("@x", {
      loader: loaderOf(["1", "2", "3", "4", "5", "6", "7"]),
      ingest: async (r) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((res) => setTimeout(res, 5));
        running--;
        return ingestedResult(r);
      },
    });
    expect(peak).toBe(IN_FLIGHT);
  });

  it("passes --limit through to discovery", async () => {
    const outcomes = await ingestChannel("@x", {
      limit: 2,
      loader: loaderOf(["1", "2", "3"]),
      ingest: async (r) => ingestedResult(r),
    });
    expect(outcomes).toHaveLength(2);
  });
});

describe("summarize — exit-code contract", () => {
  const skipped: IngestResult = {
    status: "skipped",
    ref: ref("s"),
    sourceId: "src-s",
    title: "s",
    reason: "unchanged",
  };
  const failed: IngestResult = { status: "failed", ref: ref("f"), error: new Error("x") };

  it("is ok when every video ingested or skipped", () => {
    expect(summarize([ingestedResult(ref("a")), skipped]).ok).toBe(true);
  });

  it("is ok on an all-skipped re-run (the corpus is indexed)", () => {
    expect(summarize([skipped, skipped])).toMatchObject({ skipped: 2, ok: true });
  });

  it("is not ok if any video failed", () => {
    expect(summarize([ingestedResult(ref("a")), failed])).toMatchObject({ failed: 1, ok: false });
  });

  it("is not ok on an empty run", () => {
    expect(summarize([]).ok).toBe(false);
  });
});
