# Shadcn and AI Elements Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver issue #39 as a responsive shadcn/ui and AI Elements chat shell with explicit themes and a working Sources surface.

**Architecture:** Keep `useChat`, the existing transport, Mastra memory, citation data, and channel-import workflow. Add shadcn primitives as local source, compose AI Elements around the existing chat state, and expose the smallest authenticated source/import queries required by the UI.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 4, shadcn/ui, AI Elements, AI SDK 7, tRPC 11, Drizzle, Clerk, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-shadcn-ai-elements-frontend-design.md`

## Global Constraints

- Preserve uncommitted issue #32 work and avoid broad refactors.
- Do not upgrade AI SDK or change the chat request contract.
- Use the native shadcn and AI Elements implementations, installed as local source.
- Keep every source and job operation scoped to `ctx.userId`.
- Prefer focused behavior tests; generated/configuration code does not need mirror tests.

---

### Task 1: UI foundation, theme, and responsive sidebar

**Files:**
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Create: `src/app/_components/theme-provider.tsx`
- Create: `src/app/_components/theme-toggle.tsx`
- Create/modify: shadcn primitives under `src/components/ui/`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/_components/sidebar.tsx`
- Modify: `src/styles/globals.css`

**Interfaces:**
- Produces `ThemeProvider`, `ThemeToggle`, and shadcn `SidebarProvider`/`SidebarTrigger` used by every signed-in route.

- [ ] Initialize shadcn with CSS variables and add Button, Dropdown Menu, Sheet, Sidebar, Tooltip, Separator, Progress, and Skeleton.
- [ ] Add `next-themes` and Lucide through the registry-generated dependency set.
- [ ] Wrap the application in `ThemeProvider` with `attribute="class"`, `defaultTheme="system"`, and `enableSystem`.
- [ ] Replace the fixed sidebar with shadcn's icon-collapsible sidebar and mobile sheet behavior.
- [ ] Add Chats and Sources destinations, icon tooltips, the theme menu, and Clerk account control.
- [ ] Run `pnpm typecheck` and fix only foundation errors.

### Task 2: AI Elements conversation, Markdown, citations, and recovery

**Files:**
- Create/modify: AI Elements source under `src/components/ai-elements/`
- Modify: `src/app/_components/chat-conversation.tsx`
- Modify: `src/app/_components/prompt-box.tsx`
- Modify: `src/app/_components/answer.tsx`
- Modify: `src/app/_components/answer.test.ts`
- Modify: `src/app/(app)/chats/page.tsx`

**Interfaces:**
- Consumes the existing `UIMessage[]`, `sendMessage`, `stop`, and `regenerate` contracts.
- Produces `CitedAnswer` as a Markdown response with citation actions and `copyableAnswerText(text): string` for clipboard output.

- [ ] Add a failing test proving copied answer text strips `[cite:id]` markers without collapsing surrounding prose.
- [ ] Run the focused test and verify it fails because `copyableAnswerText` is missing.
- [ ] Implement the pure formatter and rerun the focused test.
- [ ] Add AI Elements Conversation, Message, and Prompt Input from the official registry.
- [ ] Compose the existing chat hook into those components; retain seed-message and cache invalidation behavior.
- [ ] Render assistant Markdown borderlessly, preserve citation controls/source footer, and make wide content locally scrollable.
- [ ] Add copy and retry actions; retry calls `regenerate()` after clearing the surfaced error.
- [ ] Replace unconditional `scrollIntoView` with Conversation's stick-to-bottom behavior and scroll button.
- [ ] Run answer tests and `pnpm typecheck`.

### Task 3: Owned source and import query contracts

**Files:**
- Modify: `src/server/domain/source-library.ts`
- Modify: `src/server/domain/source-library.test.ts`
- Modify: `src/server/imports/channel-import.ts`
- Modify: `src/server/imports/channel-import.test.ts`
- Modify: `src/server/api/routers/imports.ts`
- Modify: `src/server/api/routers/imports.test.ts`

**Interfaces:**
- Produces `listOwnedSources(userId)`, `removeOwnedSource(userId, sourceId)`, `previewChannelImport(scope)`, and `listChannelImports(userId)`.
- Exposes tRPC `imports.preview`, `imports.list`, `imports.sources`, and `imports.removeSource`.

- [ ] Write failing domain tests for owned-source listing/removal predicates and import listing order.
- [ ] Run focused tests and confirm failures are caused by missing operations.
- [ ] Implement the minimal Drizzle queries, selecting only UI fields and requiring the owner predicate for removal.
- [ ] Add a preview operation using the existing YouTube discovery boundary with a one-video limit; return channel ID, handle, display name, and import limit 50.
- [ ] Write failing router ownership tests for list, preview, sources, and removal.
- [ ] Add protected tRPC procedures and map missing removal to `NOT_FOUND`.
- [ ] Run source/import/router tests and `pnpm typecheck`.

### Task 4: Sources page

**Files:**
- Create: `src/app/(app)/sources/page.tsx`
- Create: `src/app/_components/sources-page.tsx`
- Modify: `src/app/_components/sidebar.tsx`

**Interfaces:**
- Consumes `api.imports.preview`, `start`, `list`, `byId`, `retryFailures`, `sources`, and `removeSource`.

- [ ] Build the empty/populated library states and the two-step add-source form.
- [ ] Start imports only after the resolved preview is confirmed.
- [ ] Poll active jobs, show all summary counts and failed item messages, and stop polling terminal jobs.
- [ ] Add retry and explicit source-removal confirmation with query invalidation.
- [ ] Ensure Sources is reachable in expanded, collapsed, and mobile navigation.
- [ ] Run `pnpm typecheck` and relevant tests.

### Task 5: Integrated verification

**Files:**
- Modify only files required by findings from verification.

- [ ] Run `pnpm test` and `pnpm typecheck`.
- [ ] Start the app and inspect it through the T3 preview at desktop and mobile widths.
- [ ] Verify sidebar collapse/reopen, mobile drawer, Light/Dark/System, long Markdown overflow, code/table scrolling, scroll-to-latest, copy, retry, citation details, and composer clearance.
- [ ] Verify Sources empty state and, when credentials/data allow, preview/start/progress/retry/removal.
- [ ] Run the full test and typecheck commands once more after browser fixes.
