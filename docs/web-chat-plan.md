# Strata Web Chat Plan

Status: planned.

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
- Each run gets one streamed response to the browser.
- Each run owns exactly one agent-loop invocation.
- The persisted Strata session remains the durable conversation record.

Concurrency rules:

- Allow multiple sessions to run concurrently.
- Prevent more than one active run for the same `sessionId`.
- Abort a run if its browser stream disconnects in the first implementation.
- Later, support detached/background runs that keep executing after disconnect.
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

### tRPC Procedures

Add these under `appRouter.chat`:

- `chat.sessions.list`: recent chat/query sessions.
- `chat.sessions.get`: session metadata plus persisted messages.
- `chat.sessions.search`: simple search over prior sessions.
- `chat.models.status`: active provider/model/auth summary for UI display.

Keep tRPC DTOs browser-safe. Filesystem, session store, and model adapter construction stay in server service modules.

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
- `context`: later, for context-window and token usage display.

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

## Tool Rendering

The first web version should render every tool generically:

- Tool name.
- Parsed arguments if valid JSON, otherwise raw argument text.
- Running/completed/error status.
- Result preview with truncation awareness.

Then add specialized renderers for high-value tools:

- `shell.run`: command, cwd, exit code, duration, stdout/stderr previews.
- `fs.read` / `wiki.readPage`: path and excerpt.
- `fs.edit` / `wiki.patchPage`: path and changed-line summary.
- `memory.write` / `todo.add` / `skills.read`: learning state changes.
- Slack/Notion/Granola ingest tools once agent-facing connector tools exist.

Pi's generic tool-display pattern is a good reference, but the implementation should use AI Elements `Tool` components in React.

## Session Continuation

The browser chat should treat persisted Strata sessions as the source of truth.

Initial behavior:

- New message without `continueSessionId` starts a new session.
- After `session.started`, the UI stores the returned `sessionId`.
- Follow-up messages in the same browser conversation pass `continueSessionId`.
- Reloading a prior session uses `chat.sessions.get` to reconstruct the transcript.

Later behavior:

- Session list sidebar.
- Rename/fork/export session.
- Search previous sessions and open them in chat.
- Queue follow-up messages while a run is active, matching the TUI's queue behavior.

## Cancellation And Disconnects

First implementation:

- Submit starts a run and stream.
- Stop button calls `POST /api/chat/runs/:runId/cancel`.
- Browser disconnect aborts the run.
- Server emits a final interrupted completion event when possible.

Later:

- Keep background runs alive after disconnect.
- Add `GET /api/chat/runs/:runId/events` to reconnect to an active run.
- Persist run heartbeat/progress events for recovery.

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
9. Add token/context metrics and model/thinking controls.
10. Add richer specialized tool renderers.
11. Add optional detached/background run support if browser disconnects become painful.

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
- Context-window and token metrics render in the chat UI.
- Shell/file/wiki/learning tools have specialized renderers.
- Browser disconnect and cancellation behavior is predictable.
- Web chat and TUI behavior remain semantically aligned because both consume the same agent events.
