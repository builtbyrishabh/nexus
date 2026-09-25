import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import type { Segment } from "~/server/domain/types";

const transcriptResponse = z.object({
  content: z.array(z.object({
    text: z.string(),
    offset: z.number().nonnegative(),
    duration: z.number().nonnegative(),
  })),
});
const jobStatus = z.object({ status: z.enum(["queued", "active", "completed", "failed"]) });

async function request(url: URL, apiKey: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { "x-api-key": apiKey }, signal });
    } catch (error) {
      if (signal.aborted || attempt === 3) throw error;
      await delay(1000 * (attempt + 1), undefined, { signal });
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10_000)
        : 1000 * (attempt + 1);
      await delay(delayMs, undefined, { signal });
      continue;
    }
    return response;
  }
  throw new Error("Supadata retry limit reached");
}

/** Fetch only existing captions. `mode=native` never starts paid AI transcription. */
export async function fetchSupadataCaptions(
  videoId: string,
  apiKey: string,
): Promise<Segment[] | undefined> {
  const signal = AbortSignal.timeout(120_000);
  const url = new URL("https://api.supadata.ai/v1/transcript");
  url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  url.searchParams.set("lang", "en");
  url.searchParams.set("text", "false");
  url.searchParams.set("mode", "native");

  try {
    let response = await request(url, apiKey, signal);
    if (response.status === 206) return undefined;
    if (!response.ok) throw new Error(`${videoId}: Supadata HTTP ${response.status}`);
    let payload: unknown = await response.json();

    if (response.status === 202) {
      const job = z.object({ jobId: z.string().min(1) }).safeParse(payload);
      if (!job.success) throw new Error(`${videoId}: Supadata returned an invalid job ID`);
      const jobUrl = new URL(`https://api.supadata.ai/v1/transcript/${encodeURIComponent(job.data.jobId)}`);
      for (;;) {
        response = await request(jobUrl, apiKey, signal);
        if (response.status === 206) return undefined;
        if (!response.ok) throw new Error(`${videoId}: Supadata job HTTP ${response.status}`);
        payload = await response.json();
        const status = jobStatus.safeParse(payload);
        if (!status.success) throw new Error(`${videoId}: Supadata returned an invalid job status`);
        if (status.data.status === "completed") break;
        if (status.data.status === "failed") throw new Error(`${videoId}: Supadata transcript job failed`);
        await delay(1000, undefined, { signal });
      }
    }

    const parsed = transcriptResponse.safeParse(payload);
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
  } catch (error) {
    if (signal.aborted) throw new Error(`${videoId}: Supadata request timed out`, { cause: error });
    throw error;
  }
}
