import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSupadataCaptions } from "~/server/ingest/supadata";

afterEach(() => vi.unstubAllGlobals());

describe("Supadata native captions", () => {
  it("requests existing captions only and converts milliseconds to seconds", async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => Response.json({
      content: [
        { text: " Hello ", offset: 12500, duration: 2500, lang: "en" },
        { text: " ", offset: 15000, duration: 1000, lang: "en" },
      ],
      lang: "en",
      availableLangs: ["en"],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toEqual([
      { text: "Hello", startSec: 12.5, endSec: 15 },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url).searchParams.get("mode")).toBe("native");
    expect(new URL(url).searchParams.get("url")).toBe("https://www.youtube.com/watch?v=5e37ZT3SQbk");
    expect(init.headers).toEqual({ "x-api-key": "secret" });
  });

  it("reports unavailable captions without attempting AI generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "transcript-unavailable" }, { status: 206 })));
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toBeUndefined();
  });

  it("does not accept an empty or malformed transcript as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: [{ text: "  ", offset: 0, duration: 1000 }] })));
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).rejects.toThrow(/no text/);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: "wrong shape" })));
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).rejects.toThrow(/invalid response/);
  });

  it("surfaces provider authentication and quota errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "bad key" }, { status: 401 })));
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).rejects.toThrow(/Supadata HTTP 401/);
  });

  it("retries a rate limit and then returns captions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0.001" } }))
      .mockResolvedValueOnce(Response.json({ content: [
        { text: "Recovered", offset: 0, duration: 1000 },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toEqual([
      { text: "Recovered", startSec: 0, endSec: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses an abort deadline and retries a temporary server failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "0.001" } }))
      .mockResolvedValueOnce(Response.json({ content: [
        { text: "Available", offset: 1000, duration: 1000 },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toEqual([
      { text: "Available", startSec: 1, endSec: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a transient network failure without repeating authentication errors", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(Response.json({ content: [
        { text: "Recovered", offset: 0, duration: 1000 },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls an asynchronous native transcript job without resubmitting it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ jobId: "job-1" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ status: "queued" }))
      .mockResolvedValueOnce(Response.json({ status: "completed", content: [
        { text: "Later", offset: 2000, duration: 500 },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toEqual([
      { text: "Later", startSec: 2, endSec: 2.5 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://api.supadata.ai/v1/transcript/job-1");
    expect(String(fetchMock.mock.calls[2]![0])).toBe("https://api.supadata.ai/v1/transcript/job-1");
  });

  it("stops a stalled request at the shared deadline", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })));
    try {
      const pending = fetchSupadataCaptions("5e37ZT3SQbk", "secret");
      controller.abort(new DOMException("deadline", "TimeoutError"));
      await expect(pending).rejects.toThrow(/Supadata request timed out/);
    } finally {
      timeout.mockRestore();
    }
  });
});
