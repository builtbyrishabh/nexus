import "./_env";

import { parseArgs } from "node:util";

import { ingestChannel, summarize } from "~/server/ingest/channel";
import { ingestSource, ingestVideo } from "~/server/ingest/pipeline";
import type { IngestResult } from "~/server/ingest/pipeline";
import { youtubeLoader } from "~/server/ingest/youtube-loader";

const USAGE = `Usage:
  pnpm ingest <videoId | video URL>                 one video
  pnpm ingest --channel <scope> [--limit N]         every upload of a channel
    <scope> = @handle | UC id | channel URL | video id/URL (resolves to its owner)`;

function describe(o: IngestResult): string {
  const id = o.ref.externalId;
  switch (o.status) {
    case "ingested":
      return `✓ ingested  ${id}  "${o.title}" → ${o.chunks} chunks`;
    case "skipped":
      return `– skipped   ${id}  "${o.title}" (${o.reason})`;
    case "failed":
      return `✗ failed    ${id}  ${o.error instanceof Error ? o.error.message : String(o.error)}`;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      channel: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });

  let outcomes: IngestResult[];

  if (values.channel) {
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
      throw new Error(`--limit must be a positive integer, got ${values.limit}`);
    }
    console.log(`Discovering uploads for ${values.channel}${limit ? ` (limit ${limit})` : ""}…`);
    outcomes = await ingestChannel(values.channel, {
      limit,
      loader: youtubeLoader,
      ingest: ingestSource,
    });
  } else if (positionals[0]) {
    console.log(`Ingesting video ${positionals[0]}…`);
    outcomes = [await ingestVideo(positionals[0])];
  } else {
    throw new Error(USAGE);
  }

  for (const o of outcomes) console.log(describe(o));

  const s = summarize(outcomes);
  console.log(`\n${s.ingested} ingested · ${s.skipped} skipped · ${s.failed} failed`);
  process.exit(s.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
