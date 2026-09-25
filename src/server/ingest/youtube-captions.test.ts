import { afterEach, describe, expect, it, vi } from "vitest";

import { youtubeLoader } from "~/server/ingest/youtube-loader";

const mocks = vi.hoisted(() => ({
  env: { TRANSCRIBE_FALLBACK: false },
  getBasicInfo: vi.fn(),
}));

vi.mock("~/env", () => ({ env: mocks.env }));
vi.mock("youtubei.js", () => ({
  Log: { setLevel: () => undefined, Level: { NONE: 0 } },
  Innertube: { create: async () => ({ getBasicInfo: mocks.getBasicInfo }) },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.env.TRANSCRIBE_FALLBACK = false;
});

describe("YouTube captions in channel imports", () => {
  it("reports YouTube bot protection instead of claiming captions are absent", async () => {
    mocks.env.TRANSCRIBE_FALLBACK = true;
    mocks.getBasicInfo.mockResolvedValue({
      playability_status: {
        status: "LOGIN_REQUIRED",
        reason: "Sign in to confirm you’re not a bot",
      },
      captions: { caption_tracks: [] },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      youtubeLoader.loadTranscript({ kind: "youtube_video", externalId: "5e37ZT3SQbk" }),
    ).rejects.toThrow(/YouTube player returned LOGIN_REQUIRED.*not a bot/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.getBasicInfo).toHaveBeenCalledTimes(1);
  });

  it("indexes a playable video with an English caption track", async () => {
    const videoId = "5e37ZT3SQbk";
    mocks.getBasicInfo.mockResolvedValue({
      playability_status: { status: "OK" },
      captions: {
        caption_tracks: [
          {
            language_code: "en",
            base_url: "https://www.youtube.com/api/timedtext?test=1",
          },
        ],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") return Response.json({
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [
            { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?test=1" },
          ] } },
        });
        if (url.includes("/api/timedtext?")) {
          return new Response('<transcript><text start="12.5" dur="2.5">Real caption</text></transcript>');
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(
      youtubeLoader.loadTranscript({ kind: "youtube_video", externalId: videoId }),
    ).resolves.toEqual({
      provenance: "captions",
      segments: [{ text: "Real caption", startSec: 12.5, endSec: 15 }],
    });
  });

  it("does not pay for transcription when a caption URL returns HTTP 403", async () => {
    mocks.env.TRANSCRIBE_FALLBACK = true;
    mocks.getBasicInfo.mockResolvedValue({
      playability_status: { status: "OK" },
      captions: {
        caption_tracks: [
          {
            language_code: "en",
            base_url: "https://www.youtube.com/api/timedtext?test=1",
          },
        ],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return Response.json({
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [
            { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?test=1" },
          ] } },
        });
        if (String(input).includes("/api/timedtext?")) {
          return new Response("", { status: 403 });
        }
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );

    await expect(
      youtubeLoader.loadTranscript({ kind: "youtube_video", externalId: "5e37ZT3SQbk" }),
    ).rejects.toThrow(/caption retrieval returned HTTP 403/);
    expect(mocks.getBasicInfo).toHaveBeenCalledTimes(1);
  });
});
