import { describe, expect, it } from "vitest";

import { contentHashOf, hashGate, provenanceGate } from "~/server/ingest/pipeline";

const captions = { contentHash: "h1", metadata: { provenance: "captions" } };
const stt = { contentHash: "h1", metadata: { provenance: "stt", sttProvider: "assemblyai" } };

describe("skip gates — cheapest first", () => {
  it("provenance gate: an STT transcript is final, before any network", () => {
    expect(provenanceGate(stt)).toBe("stt-final");
    expect(provenanceGate(captions)).toBeUndefined();
    expect(provenanceGate({ contentHash: "h1", metadata: null })).toBeUndefined();
    expect(provenanceGate(undefined)).toBeUndefined();
  });

  it("hash gate: same transcript text → unchanged, anything else → proceed", () => {
    expect(hashGate(captions, "h1")).toBe("unchanged");
    expect(hashGate(captions, "h2")).toBeUndefined();
    expect(hashGate(undefined, "h1")).toBeUndefined();
  });

  it("content hash depends on the transcript text only, not timestamps or provenance", () => {
    const a = contentHashOf({
      segments: [{ text: "hi", startSec: 0 }, { text: "there", startSec: 1 }],
      provenance: "captions",
    });
    const b = contentHashOf({
      segments: [{ text: "hi", startSec: 5 }, { text: "there" }],
      provenance: "stt",
    });
    expect(a).toBe(b);
    expect(contentHashOf({ segments: [{ text: "hi" }], provenance: "captions" })).not.toBe(a);
  });
});
