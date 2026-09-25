import { z } from "zod";

import type { Segment } from "~/server/domain/types";

const transcriptResponse = z.object({
  content: z.array(z.object({
    text: z.string(),
    offset: z.number().nonnegative(),
    duration: z.number().nonnegative(),
  })),
});

/** Fetch only existing captions. `mode=native` never starts paid AI transcription. */
export async function fetchSupadataCaptions(
  videoId: string,
  apiKey: string,
): Promise<Segment[] | undefined> {
  const url = new URL("https://api.supadata.ai/v1/transcript");
  url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  url.searchParams.set("lang", "en");
  url.searchParams.set("text", "false");
  url.searchParams.set("mode", "native");

  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (response.status !== 429 || attempt === 3) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : 1000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (response.status === 206) return undefined;
  if (!response.ok) throw new Error(`${videoId}: Supadata HTTP ${response.status}`);
  if (response.status === 202) throw new Error(`${videoId}: Supadata returned an asynchronous job for native captions`);

  const parsed = transcriptResponse.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${videoId}: Supadata returned an invalid response`);
  const segments = parsed.data.content
    .filter((entry) => entry.text.trim())
    .map((entry) => ({
      text: entry.text.trim(),
      startSec: entry.offset / 1000,
      endSec: (entry.offset + entry.duration) / 1000,
    }));
  if (segments.length === 0) throw new Error(`${videoId}: Supadata caption track returned no text`);
  return segments;
}
