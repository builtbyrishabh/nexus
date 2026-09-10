# Engineering principles

Always follow DRY, ETC (Easier To Change), and orthogonality.

- **Stay native to our libraries.** Prefer the built-in, idiomatic way our dependencies already offer — Mastra, Clerk, Next.js, tRPC, Drizzle, the AI SDK, and any other library we depend on — over hand-rolled equivalents. Reach for a custom abstraction only when the native path genuinely can't do the job.
- **Write the least code that solves it.** Find the shortest, best path to the outcome. Less code is less to maintain, test, and get wrong; deleting or not-writing beats adding.
- **DRY.** One source of truth for each fact or behavior. No copy-paste divergence.
- **ETC.** Choose the design that's easier to change later; keep decisions reversible and cheap to undo.
- **Orthogonality.** Keep modules independent and single-purpose so a change in one doesn't ripple into others.
