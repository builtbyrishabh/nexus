import type { Citation, Evidence } from "~/server/domain/types";

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
 * Turn ranked Evidence into the output contract: a numbered `Citation[]` where index i maps 1:1
 * to the inline `[i+1]` marker. The evidence packet handed to the model is numbered the same way,
 * so marker index == evidence index == citation index.
 */
export function evidenceToCitations(evidence: Evidence[]): Citation[] {
  return evidence.map((e) => ({
    sourceTitle: e.source.title,
    url: e.source.url,
    startSec: e.locator?.startSec,
    timestamp:
      e.locator?.startSec === undefined
        ? undefined
        : formatTimestamp(e.locator.startSec),
    deepLink: buildDeepLink(e.source.url, e.locator?.startSec),
  }));
}

/**
 * What the model reads for one evidence entry: the situating blurb (when present) above the
 * verbatim transcript. The eval judges grade against this same string, so "faithful to the
 * evidence" means faithful to exactly what the model was shown.
 */
export function evidenceText(e: Evidence): string {
  return e.context ? `Context: ${e.context}\n${e.text}` : e.text;
}

/** Numbered, model-facing evidence packet. Marker `[n]` must map to entry `n`. */
export function buildEvidencePacket(evidence: Evidence[]): string {
  return evidence
    .map((e, i) => {
      const ts =
        e.locator?.startSec === undefined
          ? ""
          : ` (at ${formatTimestamp(e.locator.startSec)})`;
      return `[${i + 1}] ${e.source.title}${ts}\n${evidenceText(e)}`;
    })
    .join("\n\n");
}
