import "./_env";

import postgres from "postgres";

/**
 * One-time prerequisites the ORM push cannot express: the pgvector extension.
 * Run before `pnpm db:push`.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql.end();
  console.log("✓ pgvector extension ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
