# Strata Web Chat Plan

Status: foundation live-verified; durable run replay present; composer feature parity complete; token/context metrics and learning-tool renderers present.

This plan covers the local browser chat interface for Strata. It is subordinate to [roadmap.md](./roadmap.md), [agent-harness-plan.md](./agent-harness-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md).

The web chat should reuse the same agent loop, tools, session store, model adapters, and learning context as the CLI and TUI. It should not create a second agent runtime and should not shell out to the CLI as its primary transport.

## Objective

Build a local browser chat UI that makes Strata's agent usable from `apps/web` while preserving the current DRY architecture:

- CLI, TUI, and web chat are presentation layers.
- `@strata/agent` owns the model/tool loop.
- `@strata/tools` owns bash, filesystem, wiki, memory, todo, skill, and session tools.
- `@strata/core` owns runtime paths, traces, sessions, and persistent state.
- `@strata/web-api` owns the local HTTP adapter for the browser.

The first web chat milestone should feel like a browser equivalent of the TUI's core run loop: send a message, stream assistant output, show tool calls, show completion/error state, and persist the resulting session trace.

## Non-Goals

- Do not spawn `bun run strata query` from the web server for normal chat.
- Do not implement a separate browser-side agent loop.
- Do not expose raw shell/filesystem capability to the browser.
- Do not turn Strata into a cloud service or multi-user web product.
- Do not block chat work on the full connector control plane, proposal review UI, or scheduler UI.

## Package Boundary Decision

Use `packages/web-api` for the initial chat server endpoints.

Reasoning:

- It is already the local browser/server boundary for `apps/web`.
- Chat streaming is an HTTP concern, not a new agent-runtime concern.
- The actual runtime remains in `packages/agent` and `packages/tools`.
- A new package would add ceremony before there is a proven boundary to extract.

Extraction trigger:

Create `packages/agent-server` or `packages/chat-runtime` only if `packages/web-api` starts owning non-HTTP runtime state that is also needed by non-web callers. Until then, keep `packages/web-api` thin and service-oriented.

Target shape:

```text
apps/web
  React routes and AI Elements components

packages/web-api
  Hono routes, tRPC metadata procedures, streaming HTTP adapter

packages/agent
  runAgentLoopEvents(), model adapters, run context, maintenance, reflection

packages/tools
  tool registry and tool implementations

packages/core
  sessions, traces, paths, runtime state
```

## Runtime Model

Each submitted chat turn starts one server-side `runAgentLoopEvents()` invocation.

This is one loop per active run, not one permanent loop per browser tab. A continued conversation passes `continueSessionId`, causing the shared agent loop to reload the prior non-system session messages, rebuild fresh system context, append the new user turn, and continue the trace.

Run state:

- Each run gets a unique `runId`.
- Each run gets an `AbortController`.
- Each run publishes browser-safe events through a write-through event log backed by `.strata/state.sqlite`.
- Browser SSE responses subscribe to that event log; they are not the owner of the agent loop.
- SSE frames include event IDs, and `GET /api/chat/runs/:runId/events` can replay events after a given ID for reconnects or completed-run inspection.
- Browser SSE responses send heartbeat comments during quiet model/tool periods and the Bun server idle timeout is configured above the default 10 seconds, so long model requests do not close the stream.
- Each run owns exactly one agent-loop invocation.
- The persisted Strata session remains the durable conversation record.
- Web chat run metadata remains durable too: final status, cancellation, stopped reason, error message, associated session ID, and last event ID are persisted independently of the original HTTP stream.
- Server startup marks abandoned running web chat rows and their linked Strata sessions as failed with `stoppedReason: "server_restarted"` so stale active runs are visible instead of silently hanging forever.
- Web chat run lifecycle diagnostics are appended to the persisted session trace, including run start, browser stream close reason, explicit cancel requests, and run finish.
- Planned native human-interaction requests from `user.ask` should also be server-owned: `packages/web-api/src/chat.ts` should provide the `AgentUserInteraction` adapter, persist/replay pending request events, and expose an explicit response/cancel path from the browser without making the browser own the agent loop.
- The experimental terminal side panel is separate from the chat run lifecycle: `@strata/terminal-web` renders the browser terminal, `packages/web-api` owns the local shell WebSocket bridge, and terminal scrollback is not automatically written into chat sessions, traces, wiki pages, memory, or proposals. See [web-terminal-plan.md](./web-terminal-plan.md).


Concurrency rules:

- Allow multiple sessions to run concurrently, server-side and in the browser: the client streams every live run in the background through the shared multi-session run store (see Frontend Design → Multi-session run store), so switching the viewed session never interrupts another session's run.
- Prevent more than one active run for the same `sessionId`.
- Keep a run executing if its browser stream disconnects; proxy/browser request lifetimes must not cancel the agent.
- Cancel only through explicit run cancellation, which aborts the server-side `AbortController`.
- Treat repo/wiki writes as shared mutable state; add file-level or session-level locking only once write conflicts are observed.

## API Design

Use Hono routes for streaming and tRPC for non-streaming metadata.

Streaming over tRPC subscriptions would add WebSocket setup and client complexity before it is needed. A plain HTTP streaming endpoint is easier to inspect, easier to curl, and matches the shape of `runAgentLoopEvents()`.

### `POST /api/chat/runs`

Starts an agent run and returns an event stream.

Request:

```ts
interface StartChatRunRequest {
  message: string;
  continueSessionId?: string;
  model?: string;
  provider?: "openai-codex" | "openai-compatible";
  reasoningEffort?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  attachments?: Array<{
    kind: "image";
    mimeType: string;
    dataBase64: string;
    name?: string;
  }>;
}
```

Response:

- `Content-Type: text/event-stream` or newline-delimited JSON.
- First implementation should prefer SSE because it is simple to inspect and maps naturally to named events.
- If `fetch()` streaming proves simpler for request/response handling in React, newline-delimited JSON is acceptable.
- Current SSE frames include `id: <event-id>`, `event: <event-type>`, and a JSON `data:` payload. Clients should store the highest seen ID and reconnect through `GET /api/chat/runs/:runId/events?after=<event-id>` when the stream drops.

Event payloads should be a browser-safe subset of `AgentRunEvent`:

```ts
type ChatStreamEvent =
  | { type: "run.started"; runId: string }
  | { type: "session.started"; sessionId: string; title: string; model: string }
  | { type: "message.user"; content: string }
  | { type: "model.request"; iteration: number; messageCount: number }
  | { type: "assistant.delta"; iteration: number; contentDelta: string }
  | { type: "model.response"; iteration: number; content: string; usage?: Record<string, unknown> }
  | { type: "tool.call.started"; toolCallId: string; toolName: string; argumentsText: string }
  | { type: "tool.call.completed"; toolCallId: string; result: unknown }
  | { type: "agent.completed"; result: unknown }
  | { type: "agent.failed"; message: string; result?: unknown };
```

The web API should not invent different semantics from `AgentRunEvent`. It may redact, adapt, or add `runId`, but the source of truth remains `@strata/agent`.

### `POST /api/chat/runs/:runId/cancel`

Cancels an active run by aborting the server-side `AbortController`.

First implementation can return `404` when the run is no longer active.

### `GET /api/chat/runs/:runId/events`

Streams active events or replays stored events for a known web chat run.

Clients may pass `?after=<event-id>` or a `Last-Event-ID` header. Active runs subscribe after that ID; inactive runs return the stored suffix and close. Unknown run IDs return `404`.

### `chat.runs.active`

Returns browser-safe snapshots of active web chat runs. The browser uses this after a stream disconnect to keep the UI honest: the server-side run may still be executing even though the live SSE subscription ended.

### `chat.runs.get`

Returns a browser-safe snapshot for an active or completed web chat run, including status, session ID, stopped reason, error message, and last event ID. The browser uses this after reconnect exhaustion or disconnected-state polling to reload the final persisted transcript and surface terminal errors.

### tRPC Procedures

Add these under `appRouter.chat`:

- `chat.sessions.list`: recent chat/query sessions.
- `chat.sessions.get`: session metadata plus persisted messages.
- `chat.sessions.fork`: clones an existing chat/query session through `SessionStore.cloneSession`.
- `chat.sessions.search`: simple search over prior sessions.
- `chat.models.status`: active provider/model/auth summary for UI display.
- `chat.models.list`: model list for a chosen provider, backed by `@strata/agent`'s shared `listModels`.
- `chat.files.list`: repo file/directory suggestions for composer `@`-mentions, backed by `@strata/core`'s shared `findRepoFiles`.
- `chat.runs.active`: active run metadata for disconnected-stream recovery.
- `chat.runs.get`: active or terminal run metadata for final-state recovery.

Keep tRPC DTOs browser-safe. Filesystem, session store, and model adapter construction stay in server service modules.

## Composer Autocomplete Contract

The web composer uses a web-only rendering layer over shared data sources. `apps/web/src/lib/useAutocomplete.ts` defines the provider contract:

```ts
interface AutocompleteProvider {
  id: string;
  provide(input: {
    text: string;
    cursor: number;
    signal: AbortSignal;
  }): AutocompleteSuggestions | Promise<AutocompleteSuggestions | undefined> | undefined;
}

interface AutocompleteItem {
  label: string;
  value: string;
  description?: string;
  kind?: string;
  commit?: "insert" | "run";
}

interface AutocompleteSuggestions {
  items: AutocompleteItem[];
  replaceStart: number;
  replaceEnd: number;
}
```

`PromptInput` owns the textarea ref, calls providers in order through `useAutocomplete`, and renders `AutocompletePopover` at the caret. Providers should stay data-oriented and return replacement ranges only; UI concerns belong in the popover. `slashCommandProvider` runs first for leading `/` commands and may return `commit: "run"` items. `fileMentionProvider` detects active `@<query>` tokens, calls `chat.files.list`, and inserts `@path` or `@path/`. Future skill and session providers should reuse the same contract.

## Model Adapter Construction

The TUI already has model selection and auth logic. The CLI has similar logic. Before wiring web chat deeply, extract shared model-adapter construction into `@strata/agent` or a small server-safe helper that both TUI and web API can call.

Desired API:

```ts
interface CreateModelAdapterOptions {
  provider?: "openai-codex" | "openai-compatible";
  model?: string;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
}

async function createModelAdapter(options: CreateModelAdapterOptions): Promise<ModelAdapter>;
```

This prevents the web API from copying CLI/TUI auth defaults and keeps ChatGPT/OpenAI-compatible provider behavior consistent across interfaces.

## Frontend Design

Use Vercel AI Elements for the chat UI primitives. Install component source into `apps/web/src/components/ai-elements/` and adapt it to the existing Strata visual system rather than adding a second design language.

Initial components:

- `conversation`: scroll container, empty state, scroll-to-bottom affordance.
- `message`: user/assistant message layout and markdown rendering.
- `prompt-input`: multiline composer, submit button, model/thinking controls later.
- `tool`: collapsible tool-call display.
- `reasoning` or `chain-of-thought`: only if we expose safe high-level thinking/status summaries, not hidden model reasoning.
- `context`: compact context-window and token-usage display.

Initial route:

- Add `/chat` to the TanStack Router tree.
- Add sidebar navigation item `Chat`.
- Keep the layout inside the existing app shell so connector status and future schedules remain one click away.

Client state model:

```ts
interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "error";
  toolCalls?: ChatToolCallView[];
}

interface ChatToolCallView {
  id: string;
  name: string;
  argumentsText: string;
  status: "running" | "complete" | "error";
  result?: unknown;
}
```

The UI should maintain a stable transcript plus one streaming assistant message, matching the TUI and Pi pattern. Do not rebuild the whole message list on every delta if that causes scroll or render instability.

### Multi-session run store

Client run state is owned by a single shared store (`apps/web/src/lib/chatRunsStore.ts`), not by the per-view hook. The store keys `SessionRunState` (transcript, run state, usage, error, title) by session id, with one reserved `NEW_CHAT_KEY` draft slot for a not-yet-created chat; a draft migrates to its assigned session id when `session.started` arrives. The store also owns the SSE machinery (abort controllers, reconnect, disconnect detection) per run.

Because the store outlives any view, runs started in one session keep streaming while the user looks at another — switching sessions is a pure read of an already-live buffer, with no reconnect or reload flicker. `useChatRun(urlSessionId)` is a thin `useSyncExternalStore` selector over the current session's slice; per-key snapshots are immutable objects so a component viewing session A does not re-render when session B streams a token. A `discoverActiveRuns` poller attaches the store to server-side runs it is not already streaming (cross-tab / reload recovery) and reconciles transcripts for runs that finished elsewhere.

`useRunningSessionIds()` exposes the set of sessions with a live run; the sidebar and cmd-k session pickers render a pulsing accent dot for those in real time (ahead of the sessions-list query), and `session.started` refreshes that list so a brand-new run's indicator appears immediately.

### Local realtime change feed (cross-process / cross-tab)

Per-run SSE only covers runs this browser started. To reflect sessions advanced **anywhere** — another tab, or the CLI/TUI/maintenance/ingest writing directly to the shared `.strata/state.sqlite` — the web-api runs a local realtime hub instead of moving data off the box.

- `packages/core` `SessionStore.sessionChangesSince(afterEventId)` / `latestEventId()` tail the shared append-only `events` table (every process appends there, including `session.started`/`session.ended`, so new sessions, message/tool progress, and status flips are all observable).
- `packages/web-api/src/changeFeed.ts` `SessionChangeFeed` polls that tail (~750ms), establishes a high-water baseline so it never replays history, and fans out `{ sessionIds, maxEventId }` notices to subscribers. `GET /api/changes` streams them as SSE with heartbeats.
- The browser store opens `/api/changes` once (reconnecting on drop). On a notice it invalidates the sessions-list query (sidebar/cmd-k freshness), pokes `discoverActiveRuns` (instant attach for newly-started web runs), and `reloadSession()`s any loaded session this tab isn't itself streaming — refetching its persisted transcript so CLI/TUI-driven (and other-tab) progress appears live. `reloadSession` skips client-streamed sessions and never mutates `runState`, so it can't race the discovery reconciler.

This keeps everything local (it's a notification layer over the existing SQLite event log, not a new datastore), so a session advanced by the CLI shows its messages filling in live in every open web tab.

When the viewed session has a run active server-side that this tab isn't streaming itself (a CLI/TUI run, since those aren't web runs the client can attach to), `SessionRunState.externallyRunning` is set from the persisted session status. The chat view surfaces a "running elsewhere" badge and locks the composer/submit so the user doesn't trigger the server's one-run-per-session conflict; it clears to idle when the external run finishes. This flag is deliberately separate from `runState` (which only reflects a stream this tab owns) so it never races the discovery reconciler.

## Tool Rendering

The first web version should render every tool generically:

- Tool name.
- Parsed arguments if valid JSON, otherwise raw argument text.
- Running/completed/error status.
- Result preview with truncation awareness.

The current web route adds specialized renderers for high-value tools:

- `shell.run`: command, cwd, exit code, duration, stdout/stderr previews. While the command is still running it renders a live terminal that appends `tool.output` stdout/stderr deltas in real time (auto-scrolling, with a streaming cursor), then shows the final result panel on completion.
- `fs.read` / `wiki.readPage`: path and excerpt.
- `fs.edit` / `wiki.patchPage`: path and changed-line summary.
- `memory.write` / `memory.append`: target, path, size, and changed content preview.
- `todo.add` / `todo.update` / `todo.remove`: action, status, priority, due date, title, id, tags, and notes.
- `skills.list` / `skills.read`: count/source/path metadata and compact skill rows or content preview.
- Planned `user.ask`: pending question card for select/confirm/text prompts, submitted answer/cancel state, and replay-safe rendering from durable run events.
- Slack/Notion/Granola ingest tools once agent-facing connector tools exist.

Pi's generic tool-display pattern is a good reference, but the implementation should use AI Elements `Tool` components in React.

## Session Continuation

The browser chat should treat persisted Strata sessions as the source of truth.

Initial behavior:

- New message without `continueSessionId` starts a new session.
- After `session.started`, the UI stores the returned `sessionId`.
- Follow-up messages in the same browser conversation pass `continueSessionId`.
- Reloading a prior session uses `chat.sessions.get` to reconstruct the transcript.
- While a run is active, additional prompt submissions enqueue client-side and drain FIFO after the current run returns to idle. Stop clears queued follow-ups before cancelling the active run.
- When a planned `user.ask` request is pending, the question card owns its own answer controls; normal prompt submissions should continue to mean queued follow-up chat messages, not implicit answers to the question.

Later behavior:

- Session list sidebar.
- Rename/fork/export session.
- Search previous sessions and open them in chat.

## Cancellation And Disconnects

Current implementation:

- Submit starts a run and stream.
- Stop button calls `POST /api/chat/runs/:runId/cancel`.
- Browser/proxy disconnect closes only that SSE subscription; the run continues server-side.
- The browser stores the latest SSE event ID and can reconnect through `GET /api/chat/runs/:runId/events`.
- If reconnects fail or disconnected-state polling sees the run finish, the browser loads `chat.runs.get` plus `chat.sessions.get` to show the persisted terminal state.
- When a session route loads while a run is still active, the browser checks active runs for that session and attaches to the replay stream after the latest stored event ID.
- Server emits a final interrupted completion event when cancellation reaches the agent loop.

## Security And Locality

The web chat is a privileged local control surface because the agent can run shell and write files.

Requirements:

- Bind API to loopback by default.
- Keep dangerous tool execution server-side only.
- Do not send secrets, auth tokens, or raw env values to the browser.
- Redact tool results where needed before rendering.
- Do not add a browser-accessible endpoint for arbitrary tool calls unless it goes through the agent/session trace path.
- If `STRATA_WEB_HOST=0.0.0.0` is used for exe.dev proxy testing, treat the URL as private and temporary.

## Relationship To Pi

Pi has two relevant ideas:

- Its browser web UI has strong chat components and message/tool rendering patterns.
- Its coding-agent RPC mode provides a JSONL stdin/stdout protocol for embedding a CLI process.

For Strata's first web chat, copy the UI and event-model ideas, not the process boundary.

Reasons:

- Strata already has a local Hono web API process.
- The shared `runAgentLoopEvents()` generator is directly callable from that server.
- Spawning a CLI subprocess would add lifecycle, logging, cancellation, auth/env, and stdout parsing complexity without adding bash capability.

Later, a `strata --mode rpc` JSONL mode may still be useful for external embedding or editor integrations. It should not be the primary path from `apps/web` to the agent loop.

## Sequencing

1. Extract shared model-adapter factory from CLI/TUI duplication.
2. Add `packages/web-api` chat services for model status, session loading, and active-run registry.
3. Add `POST /api/chat/runs` streaming endpoint over `runAgentLoopEvents()`.
4. Add cancellation endpoint and one-active-run-per-session guard.
5. Install AI Elements components into `apps/web`.
6. Add `/chat` route with conversation, messages, prompt input, and generic tool panels.
7. Add session continuation in the UI.
8. Add recent sessions/search sidebar.
9. Make web chat runs independent of the original HTTP request lifetime, persist run/event state, and add replayable reconnects.
10. Add token/context metrics and model/thinking controls. Status: complete.
11. Add richer specialized tool renderers. Status: complete for wiki/file/shell/learning tools.
12. Browser-verify reconnect edge cases and finish responsive polish. Status: complete; dropped-stream reconnect/recovery and responsive mobile/tablet/narrow-desktop behavior are browser-verified.

## Acceptance Criteria

The first useful web chat milestone is complete when:

- `/chat` exists in `apps/web`.
- A user can submit a message from the browser.
- The web API streams events from `runAgentLoopEvents()`.
- Assistant deltas render incrementally.
- Tool calls render as running and completed states.
- The run persists to the existing Strata session store.
- A follow-up message continues the same session.
- The user can stop an active run.
- `bun run check:workspaces` and relevant tests pass.

The second milestone is complete when:

- Prior chat sessions can be listed, searched, opened, and continued.
- Browser disconnect, reconnect, cancellation, and final-error surfacing are predictable.
- Context-window and token metrics render in the chat UI.
- Shell/file/wiki/learning tools have specialized renderers.
- Web chat and TUI behavior remain semantically aligned because both consume the same agent events.
