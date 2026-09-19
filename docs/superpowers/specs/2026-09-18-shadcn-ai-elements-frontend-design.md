# Shadcn and AI Elements Frontend Design

**Issue:** https://github.com/builtbyrishabh/nexus/issues/39

## Goal

Refresh Nexus around shadcn/ui and AI Elements while keeping the current AI SDK transport, Mastra memory, citations, and durable channel-import workflow intact.

## App shell

The signed-in application uses one responsive shell. On desktop, navigation is expanded by default and collapses to an icon rail. The choice is saved locally. On mobile, the same navigation content opens in a modal sheet and never permanently consumes conversation width.

The expanded sidebar contains the Nexus identity, New chat, Sources, chat history, the theme selector, and the Clerk account control. The collapsed rail keeps the primary destinations and controls discoverable through icons, accessible names, and tooltips.

Theme selection supports light, dark, and system modes through `next-themes`. Existing semantic colors are mapped onto shadcn variables so chat, dialogs, Sources, and Clerk controls share one palette.

## Conversation

The existing `useChat` lifecycle and request transport remain the source of conversation state. AI Elements provides the conversation scroller, messages, Markdown response, and prompt input. Assistant responses are borderless and occupy the full reading column. User messages retain a quiet neutral bubble.

The reading column is centered and bounded for legibility. Every flex ancestor may shrink. Prose and long URLs wrap; code and tables scroll inside their own containers. The composer shares the reading width and remains visible without covering the final response.

Automatic scrolling follows output only while the reader is already near the bottom. A jump-to-latest control appears after the reader scrolls away. Response errors expose retry through the AI SDK `regenerate` API. Copying an answer removes internal citation markers.

## Citations

The current citation registry, stable numbering, grouped source footer, source transcript, generated context, and timestamp links remain. Citation markers are replaced with safe inline controls without preventing Markdown parsing around them. The source footer stays hidden for the currently streaming message and appears on completion.

## Sources

Sources is a first-class route backed by authenticated tRPC procedures. It lists sources owned by the current user and the user's recent import jobs. A two-step add flow resolves a supported YouTube scope, presents canonical channel identity and the latest-50 scope, then starts the existing durable import.

Job detail polls only while active and displays discovered, queued, processing, ingested, skipped, and failed counts. Failed items can be retried through the existing workflow. Removing a source deletes only the requesting user's owned record; it cannot mutate another user's data.

The existing import service gains only the read and preview operations the UI requires. Discovery and ingestion stay in their current modules.

## Verification

Pure formatting and source/import contracts receive focused Vitest coverage. Existing router ownership tests expand for every new authenticated operation. Browser verification covers desktop and mobile navigation, all theme modes, long Markdown/URLs/code/tables, streaming scroll behavior, citation dialogs, Sources empty/populated states, and composer clearance.
