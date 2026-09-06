import "./_env";

import { ingestChannel } from "~/server/ingest/channel";
import { ingestVideo } from "~/server/ingest/pipeline";

// Single-video stand-in: Steve Jobs' 2005 Stanford commencement — reliably captioned, clear
// spoken content, good for Q&A and the golden eval set.
const STAND_IN_VIDEO_ID = "UF8uR6Z6KLc";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  pnpm ingest [<videoIdOrUrl>]            ingest one video (default: stand-in)",
      "  pnpm ingest --channel <ref> [--limit N] ingest a channel's uploads (all, or newest N)",
      "                                          <ref> = UC id | @handle | channel URL | any video URL",
    ].join("\n"),
  );
  process.exit(1);
}

async function ingestOne(videoId: string) {
  console.log(`Ingesting video ${videoId}…`);
  const r = await ingestVideo(videoId);
  console.log(
    r.skipped
      ? `✓ Skipped (transcript unchanged): "${r.title}"`
      : `✓ Ingested "${r.title}" → ${r.chunks} chunks`,
  );
}

/** Ingest a channel; returns true when the run is healthy (nothing failed and something landed). */
async function ingestWholeChannel(ref: string, limit?: number): Promise<boolean> {
  console.log(`Discovering uploads for ${ref}…`);
  const result = await ingestChannel(ref, {
    limit,
    onProgress: (o) => {
      if (o.status === "failed") console.log(`  ✗ ${o.videoId}: ${o.error}`);
      else console.log(`  ${o.status === "skipped" ? "•" : "✓"} ${o.title} (${o.chunks} chunks)`);
    },
  });
  console.log(
    `\nChannel done: ${result.ingested} ingested, ${result.skipped} skipped, ` +
      `${result.failed} failed (of ${result.discovered} discovered).`,
  );
  // A cron/CI step must not read a stale corpus as success: any failure, or a run that indexed
  // nothing at all (paused DB, bad key, empty discovery), is a non-zero exit.
  return result.failed === 0 && result.ingested + result.skipped > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const channelIdx = args.indexOf("--channel");

  if (channelIdx !== -1) {
    const ref = args[channelIdx + 1];
    if (!ref || ref.startsWith("--")) usage();
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) usage();
    const ok = await ingestWholeChannel(ref, limit);
    process.exit(ok ? 0 : 1);
  }

  await ingestOne(args[0] ?? STAND_IN_VIDEO_ID);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
