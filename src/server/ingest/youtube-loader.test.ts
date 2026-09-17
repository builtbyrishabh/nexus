import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  creatorHandleOf,
  resolveYoutubeChannel,
  toSeconds,
  toVideoId,
  youtubeLoader,
} from "~/server/ingest/youtube-loader";

describe("toVideoId — one identity for URL or ID", () => {
  it("passes a bare 11-char video ID through", () => {
    expect(toVideoId("UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
  });

  it("extracts the ID from a watch URL (incl. extra params)", () => {
    expect(toVideoId("https://www.youtube.com/watch?v=UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
    expect(
      toVideoId("https://www.youtube.com/watch?v=UF8uR6Z6KLc&t=42s&list=abc"),
    ).toBe("UF8uR6Z6KLc");
  });

  it("extracts the ID from a youtu.be short URL", () => {
    expect(toVideoId("https://youtu.be/UF8uR6Z6KLc")).toBe("UF8uR6Z6KLc");
    expect(toVideoId("https://youtu.be/UF8uR6Z6KLc?t=42")).toBe("UF8uR6Z6KLc");
  });

  it("handles embed / shorts / live URL forms", () => {
    expect(toVideoId("https://www.youtube.com/embed/UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
    expect(toVideoId("https://www.youtube.com/shorts/UF8uR6Z6KLc")).toBe(
      "UF8uR6Z6KLc",
    );
  });

  it("rejects a value that is not a YouTube video", () => {
    expect(() => toVideoId("not a video")).toThrow();
    expect(() => toVideoId("https://example.com/watch?v=UF8uR6Z6KLc")).toThrow();
    expect(() => toVideoId("https://www.youtube.com/watch?v=too-short")).toThrow();
  });
});

describe("creatorHandleOf — canonical creator identity", () => {
  it("uses YouTube's canonical vanity handle", () => {
    expect(
      creatorHandleOf(
        "https://www.youtube.com/@AlexHormozi",
        "UC-fallback",
      ),
    ).toBe("alexhormozi");
  });

  it("falls back to the stable channel id", () => {
    expect(creatorHandleOf(undefined, "UC-stable")).toBe("UC-stable");
    expect(creatorHandleOf("not a url", "UC-stable")).toBe("UC-stable");
  });
});

describe("toSeconds — unit normalization at the boundary", () => {
  it("passes through a normal-length transcript already in seconds (classic format)", () => {
    // Classic <text start="s" dur="s"> path: values are seconds.
    const transcript = [
      { text: "a", offset: 0, duration: 3.2 },
      { text: "b", offset: 3.2, duration: 2.8 },
      { text: "c", offset: 6, duration: 4 },
    ];
    const segments = toSeconds(transcript);
    expect(segments[0]).toEqual({ text: "a", startSec: 0, endSec: 3.2 });
    expect(segments[2]).toEqual({ text: "c", startSec: 6, endSec: 10 });
  });

  it("normalizes a SHORT millisecond transcript (the regression: total span < 86_400)", () => {
    // srv3 <p t="ms"> path on a ~9s clip. Total span never crosses a max-span threshold,
    // but per-segment durations (~3000ms) reveal the ms unit.
    const transcript = [
      { text: "a", offset: 0, duration: 3000 },
      { text: "b", offset: 3000, duration: 3000 },
      { text: "c", offset: 6000, duration: 3000 },
    ];
    const segments = toSeconds(transcript);
    expect(segments[0]).toEqual({ text: "a", startSec: 0, endSec: 3 });
    expect(segments[2]).toEqual({ text: "c", startSec: 6, endSec: 9 });
  });

  it("normalizes a long millisecond transcript", () => {
    const transcript = [
      { text: "a", offset: 0, duration: 4000 },
      { text: "b", offset: 600_000, duration: 4000 }, // 10 min in
    ];
    const segments = toSeconds(transcript);
    expect(segments[1]).toEqual({ text: "b", startSec: 600, endSec: 604 });
  });
});

// ---------------------------------------------------------------------------------------------
// loadTranscript — captions first, STT only behind every guard. Network mocked at the seams:
// the caption library, Innertube, and the AI SDK `transcribe()` call (the paid one).
// ---------------------------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  env: { TRANSCRIBE_FALLBACK: false, ASSEMBLYAI_API_KEY: "test-key" },
  fetchTranscript: vi.fn(),
  getBasicInfo: vi.fn(),
  getChannel: vi.fn(),
  resolveURL: vi.fn(),
  download: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("~/env", () => ({ env: mocks.env }));
vi.mock("youtube-transcript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("youtube-transcript")>();
  return { ...actual, YoutubeTranscript: { fetchTranscript: mocks.fetchTranscript } };
});
vi.mock("youtubei.js", () => ({
  Log: { setLevel: () => undefined, Level: { NONE: 0 } },
  Innertube: {
    create: async () => ({
      getBasicInfo: mocks.getBasicInfo,
      getChannel: mocks.getChannel,
      resolveURL: mocks.resolveURL,
    }),
  },
}));
vi.mock("ai", () => ({ transcribe: mocks.transcribe }));

const ref = { kind: "youtube_video", externalId: "UF8uR6Z6KLc" } as const;

describe("resolveYoutubeChannel — every supported source input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChannel.mockResolvedValue({
      metadata: {
        external_id: "UC1234567890123456789012",
        title: "Creator Name",
        vanity_channel_url: "https://www.youtube.com/@Creator",
      },
    });
  });

  it("resolves a video URL through its owning channel", async () => {
    mocks.getBasicInfo.mockResolvedValue({
      basic_info: { channel_id: "UCfromvideo" },
    });

    await expect(
      resolveYoutubeChannel(
        "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
      ),
    ).resolves.toEqual({
      channelId: "UCfromvideo",
      creatorHandle: "creator",
      displayName: "Creator Name",
    });
    expect(mocks.getChannel).toHaveBeenCalledWith("UCfromvideo");
  });

  it.each([
    "@Creator",
    "https://www.youtube.com/@Creator",
    "https://www.youtube.com/channel/UC1234567890123456789012",
  ])("resolves the handle or channel URL %s", async (scope) => {
    mocks.resolveURL.mockResolvedValue({
      payload: { browseId: "UC1234567890123456789012" },
    });

    await expect(resolveYoutubeChannel(scope)).resolves.toMatchObject({
      channelId: "UC1234567890123456789012",
      creatorHandle: "creator",
    });
  });

  it("accepts a bare channel ID", async () => {
    await resolveYoutubeChannel("UC1234567890123456789012");

    expect(mocks.resolveURL).not.toHaveBeenCalled();
    expect(mocks.getChannel).toHaveBeenCalledWith("UC1234567890123456789012");
  });
});

function videoOf(durationSec: number | undefined) {
  mocks.getBasicInfo.mockResolvedValue({
    basic_info: { duration: durationSec },
    download: mocks.download,
  });
  mocks.download.mockImplementation(async () => new Blob([new Uint8Array([1, 2, 3])]).stream());
}

describe("loadTranscript — captions first, STT only behind every guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.TRANSCRIBE_FALLBACK = false;
    mocks.transcribe.mockResolvedValue({
      segments: [
        { text: "Hello", startSecond: 0, endSecond: 0.5 },
        { text: "world.", startSecond: 0.6, endSecond: 1 },
      ],
    });
  });

  it("captions present → captions provenance, nothing paid", async () => {
    mocks.fetchTranscript.mockResolvedValue([{ text: "hi", offset: 0, duration: 1 }]);
    await expect(youtubeLoader.loadTranscript(ref)).resolves.toEqual({
      segments: [{ text: "hi", startSec: 0, endSec: 1 }],
      provenance: "captions",
    });
    expect(mocks.getBasicInfo).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("no captions + flag off → fails naming the flag, before any Innertube call", async () => {
    mocks.fetchTranscript.mockRejectedValue(new YoutubeTranscriptDisabledError("UF8uR6Z6KLc"));
    await expect(youtubeLoader.loadTranscript(ref)).rejects.toThrow(/TRANSCRIBE_FALLBACK=true/);
    expect(mocks.getBasicInfo).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("rate limit / private / network rethrow as-is — never STT, even with the flag on", async () => {
    mocks.env.TRANSCRIBE_FALLBACK = true;
    for (const error of [
      new YoutubeTranscriptTooManyRequestError(),
      new YoutubeTranscriptVideoUnavailableError("UF8uR6Z6KLc"),
      new TypeError("fetch failed"),
    ]) {
      mocks.fetchTranscript.mockRejectedValue(error);
      await expect(youtubeLoader.loadTranscript(ref)).rejects.toBe(error);
    }
    expect(mocks.getBasicInfo).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("over the cap → fails before a byte is downloaded", async () => {
    mocks.env.TRANSCRIBE_FALLBACK = true;
    mocks.fetchTranscript.mockRejectedValue(new YoutubeTranscriptDisabledError("UF8uR6Z6KLc"));
    videoOf(200 * 60);
    await expect(youtubeLoader.loadTranscript(ref)).rejects.toThrow(/over the 180 min STT cap/);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("flag on + genuinely no captions → exactly one transcribe() call, stt provenance", async () => {
    mocks.env.TRANSCRIBE_FALLBACK = true;
    mocks.fetchTranscript.mockRejectedValue(new YoutubeTranscriptNotAvailableError("UF8uR6Z6KLc"));
    videoOf(5 * 60);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(youtubeLoader.loadTranscript(ref)).resolves.toEqual({
      segments: [{ text: "Hello world.", startSec: 0, endSec: 1 }],
      provenance: "stt",
      sttProvider: "assemblyai",
    });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ type: "audio" }));
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(Array.from(mocks.transcribe.mock.calls[0]![0].audio as Uint8Array)).toEqual([1, 2, 3]);
    stderr.mockRestore();
  });

  it("captions that exist but are empty count as no captions", async () => {
    mocks.env.TRANSCRIBE_FALLBACK = true;
    mocks.fetchTranscript.mockResolvedValue([]);
    videoOf(60);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(youtubeLoader.loadTranscript(ref)).resolves.toMatchObject({ provenance: "stt" });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
  });
});
