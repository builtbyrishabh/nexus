# Launch readiness

## Fixed in this release

- Chat input is capped at 8,000 characters, model context at 20 recent messages, and paid work at
  100 chat messages plus 3 import starts or retries per user per UTC day. Quota updates are atomic.
- The Drizzle CLI loads `.env.local` and `.env`, local environment files are ignored, and the setup
  guide distinguishes user-owned Sources imports from unowned maintenance CLI ingestion.
- CI typechecks, tests, and builds from a secretless configuration. The repository carries an MIT
  license and patched direct or scoped transitive dependency versions for known production advisories.

## Release-owner checks

- Run `pnpm db:setup && pnpm db:push` against production before deploying the quota schema.
- Configure production Clerk and AI provider credentials, provider spending limits, and an edge-level
  global rate limit. Per-user application quotas do not cap aggregate spend across many accounts.
- Smoke-test a signed-in Sources import and one cited chat answer against the production database.
- Confirm the deployment platform's workflow duration and concurrency settings match the import load.

## Verification evidence

- Focused request, route, import-router, and memory tests: 31 passed.
- `pnpm typecheck`: passed.
- `DATABASE_URL=postgresql://user:password@localhost:5432/nexus pnpm build`: passed with the
  existing Mastra dynamic-dependency webpack warning.
- `pnpm audit --prod`: no known vulnerabilities.
- An equivalent parameterized quota UPSERT accepted 3 of 12 concurrent import attempts in PGlite,
  rejected the next attempt, and preserved user and action isolation. This is a local
  PostgreSQL-compatible check rather than execution through the Drizzle helper;
  production PostgreSQL and authenticated browser flows still require the release-owner smoke tests.
