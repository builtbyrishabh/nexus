import { z } from "zod";

import type { Evidence } from "~/server/domain/types";

export const catalogEvidenceSchema = z.object({
  citationId: z.string().min(1),
  text: z.string(),
  title: z.string(),
  url: z.string().url(),
  startSec: z.number().nonnegative().optional(),
  timestamp: z.string().optional(),
});

export const catalogSearchResultSchema = z.object({
  evidence: z.array(catalogEvidenceSchema),
});

export type CatalogEvidence = z.infer<typeof catalogEvidenceSchema>;
export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;

/** Seconds → "m:ss" or "h:mm:ss". */
export function formatTimestamp(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Build a YouTube deep-link to a timestamp, when the URL is a watch URL. */
export function buildDeepLink(url: string, startSec?: number): string {
  if (startSec === undefined) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Math.floor(startSec)}`;
}

/**
 * What the model reads for one evidence entry: the situating blurb (when present) above the
 * verbatim transcript. The eval judges grade against this same string, so "faithful to the
 * evidence" means faithful to exactly what the model was shown.
 */
export function evidenceText(e: Evidence): string {
  return e.context ? `Context: ${e.context}\n${e.text}` : e.text;
}

/** Convert one retrieval result into the tool output shared by the model and citation UI. */
export function toCatalogEvidence(evidence: Evidence): CatalogEvidence {
  const startSec = evidence.locator?.startSec;
  return {
    citationId: evidence.chunkId,
    text: evidenceText(evidence),
    title: evidence.source.title,
    url: buildDeepLink(evidence.source.url, startSec),
    ...(startSec === undefined
      ? {}
      : { startSec, timestamp: formatTimestamp(startSec) }),
  };
}
