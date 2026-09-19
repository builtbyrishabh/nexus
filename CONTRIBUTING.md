# Contributing to Nexus

Thanks for helping improve Nexus. Small, focused changes are easiest to review and maintain.

## Before you start

- Search the existing issues before opening a new one.
- Open an issue before making a large product or architecture change.
- Never commit credentials, user data, transcripts, or local environment files.

## Local setup

You need Node.js 22, pnpm 10, and Postgres with the `vector` extension.

```bash
pnpm install
cp .env.example .env.local
pnpm db:setup
pnpm db:push
pnpm dev
```

See the [README](README.md#run-locally) for the required services and environment variables.

## Making a change

1. Create a branch from `main`.
2. Keep the change scoped to one problem.
3. Add focused tests for behavior that changed.
4. Run the project checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

5. Open a pull request that explains the problem and the solution.

Use conventional commit-style titles when practical, for example
`fix(chat): preserve citations while streaming`.

## Project principles

- Prefer native capabilities from Next.js, Mastra, the AI SDK, Clerk, Drizzle, and tRPC.
- Keep one source of truth for each behavior.
- Choose the least code that solves the problem.
- Keep modules independent and make decisions easy to change.

For the system boundaries and data flow, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
