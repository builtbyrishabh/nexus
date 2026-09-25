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
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(Response.json({ content: [
        { text: "Recovered", offset: 0, duration: 1000 },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSupadataCaptions("5e37ZT3SQbk", "secret")).resolves.toEqual([
      { text: "Recovered", startSec: 0, endSec: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
