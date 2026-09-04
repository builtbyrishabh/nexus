import "./_env";

import { ingestVideo } from "~/server/ingest/pipeline";

// Slice 0 stand-in: Steve Jobs' 2005 Stanford commencement — reliably captioned, clear
// spoken content, good for Q&A. The real creator is chosen at Slice 3 (full-channel ingest).
const STAND_IN_VIDEO_ID = "UF8uR6Z6KLc";

async function main() {
  const videoId = process.argv[2] ?? STAND_IN_VIDEO_ID;
  console.log(`Ingesting video ${videoId}…`);

  const result = await ingestVideo(videoId);
  if (result.skipped) {
    console.log(`✓ Skipped (transcript unchanged): "${result.title}"`);
  } else {
    console.log(`✓ Ingested "${result.title}" → ${result.chunks} chunks`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
