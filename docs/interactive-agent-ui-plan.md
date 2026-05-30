# Interactive Agent UI Plan

Status: planned native ask-user/user-interaction primitive.

This plan is subordinate to [roadmap.md](./roadmap.md), [agent-harness-plan.md](./agent-harness-plan.md), [tui-plan.md](./tui-plan.md), [web-chat-plan.md](./web-chat-plan.md), and [extensions-plan.md](./extensions-plan.md). It defines how Strata should let the model ask the user a bounded question and receive the answer back without waiting for the full Pi-style extension runtime.

Pi is the behavioral reference for the UI shape, especially `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.editor()`, and the `question.ts` / `questionnaire.ts` extension examples under `/home/exedev/Documents/pi-mono/packages/coding-agent/`. Do not copy Pi code wholesale. Implement the capability as a native Strata agent/tool primitive first, then expose the same surface to future extensions later.

## Objective

Add a native, trace-backed `user.ask` tool that the model can call when it needs clarification, confirmation, or a constrained preference from the user before proceeding.

The primitive should:

- be callable through the normal `ToolRegistry` and persisted as normal tool calls/results;
- support text input, yes/no confirmation, single-choice selection, and optional free-form "other" answers;
- work through surface-specific adapters rather than hard-coding TUI or web behavior into the agent loop;
- preserve Strata's shared-agent-loop invariant for CLI, TUI, web chat, scheduled jobs, and future extensions;
- be safe in non-interactive contexts by returning an explicit `unavailable`/`cancelled` result instead of hanging;
- be compatible with future Pi-style `ctx.ui` extension APIs.

## Non-Goals

- Do not build the full `@strata/extensions` runtime for this slice.
- Do not add arbitrary extension `ctx.ui.custom()`-style rendering yet.
- Do not let the browser run the agent loop or resolve questions outside the server-owned run.
- Do not persist user answers as memory/wiki/todos automatically. The answer is just a tool result unless the model later uses an explicit write/learning tool.
- Do not make scheduled jobs block forever waiting for a human.

## Product Semantics

The model-facing tool should be named `user.ask`.

Initial input schema:

```ts
interface UserAskInput {
  question: string;
  description?: string;
  responseType: "text" | "confirm" | "select";
  options?: Array<{
    id?: string;
    label: string;
    description?: string;
  }>;
  allowOther?: boolean;
  placeholder?: string;
  defaultOptionId?: string;
  timeoutMs?: number;
}
```

Validation rules:

- `question` is required and must be bounded.
- `responseType: "select"` requires at least one option.
- `responseType: "confirm"` ignores `options` and renders yes/no.
- `timeoutMs` is optional and must be clamped to a safe maximum.
- `allowOther` only applies to `select`; it adds a free-form text path.

Initial result schema:

```ts
type UserAskResult =
  | {
      status: "answered";
      responseType: "text" | "confirm" | "select";
      answerText?: string;
      confirmed?: boolean;
      optionId?: string;
      optionLabel?: string;
      wasOther?: boolean;
      requestId: string;
    }
  | {
      status: "cancelled" | "timeout" | "unavailable";
      responseType: "text" | "confirm" | "select";
      message: string;
      requestId: string;
    };
```

`user.ask` should be registered as a `read` tool initially. It reads user input and has no repository side effects, so it should be available in read-only, maintenance, learning, and dangerous profiles. It must set `executionMode: "sequential"` so a batch containing a user prompt cannot run other tools concurrently while waiting for the person.

## Architecture

### Shared Types

Add a small shared interaction type module, preferably in `packages/core` so both `@strata/tools` and `@strata/agent` can import it without cycles.

Suggested types:

```ts
export interface AgentUserAskRequest {
  requestId: string;
  toolCallId?: string;
  sessionId?: string;
  question: string;
  description?: string;
  responseType: "text" | "confirm" | "select";
  options: AgentUserAskOption[];
  allowOther: boolean;
  placeholder?: string;
  defaultOptionId?: string;
  timeoutMs?: number;
}

export interface AgentUserInteraction {
  ask(request: AgentUserAskRequest, context: AgentUserAskContext): Promise<AgentUserAskResponse>;
}
```

Keep this interface narrow. It is the seed of the future extension `ctx.ui` API, not the full extension UI API.

### Tool Context

Extend `ToolContext` in `packages/tools/src/types.ts` with an optional interaction adapter:

```ts
ui?: AgentUserInteraction;
```

The agent loop should pass a wrapped adapter into tool execution. The wrapper should attach `sessionId` and `toolCallId`, generate or preserve a `requestId`, enforce cancellation, and append trace events.

### Agent Run Config

Extend `AgentRunConfig` with:

```ts
ui?: AgentUserInteraction;
```

If omitted, `user.ask` returns `status: "unavailable"` quickly. This is the default for CLI print/query runs, scheduler jobs, and tests unless they opt in.

### Trace Events

Add small append-only session events when a question is requested and resolved. Do not store secrets or large free-form payloads beyond the bounded question/answer.

Suggested event names:

- `agent.ui.ask.requested`
- `agent.ui.ask.resolved`

Payloads should include:

- `requestId`
- `toolCallId`
- `toolName: "user.ask"`
- `responseType`
- bounded `question`
- option count and labels/descriptions if bounded
- result status and bounded answer metadata

These events make later debugging possible even if the surface-specific UI was disconnected.

### Agent Run Events

Add corresponding `AgentRunEvent` variants only if surfaces need generic live updates outside the tool panel:

```ts
| { type: "ui.ask.requested"; request: BrowserSafeAgentUserAskRequest }
| { type: "ui.ask.resolved"; requestId: string; status: ... }
```

For the first implementation, it is acceptable for TUI to use the adapter directly and web to publish web-owned pending-question events from its adapter. If the same event shape is needed by both, promote it into `AgentRunEvent` so CLI/TUI/web receive a single stream shape.

The invariant is that `user.ask` remains a normal tool call. The live UI event is an ergonomics layer, not a second tool system.

## Surface Behavior

### TUI

Implement a TUI `AgentUserInteraction` adapter in `packages/tui/src/app/app.ts` or a focused helper under `packages/tui/src/app/userAsk.ts`.

Behavior:

- When `user.ask` is called, temporarily replace the normal editor with a focused question component.
- `select`: render a compact option list; arrow keys navigate; Enter chooses; Escape cancels. If `allowOther` is set, include a "Type something" row that switches into text input.
- `confirm`: render Yes/No using the same picker component.
- `text`: render a single-line input first; a multiline editor can be a later enhancement.
- Restore the normal editor with its prior text after answer/cancel.
- Preserve existing queued-message behavior where possible, but question focus should take priority while the question is pending.
- Respect run cancellation: aborting the agent run should dismiss the question and return `cancelled`.

Testing:

- Use `FakeTerminal`/e2e tests; do not require a real PTY.
- Cover selection, text answer, escape cancel, and cancellation while pending.

### Web Chat

Implement a web `AgentUserInteraction` adapter inside `packages/web-api/src/chat.ts` because web runs are server-owned jobs.

Server behavior:

- When a question is requested, create a pending UI request record keyed by `runId` and `requestId`.
- Publish a browser-safe event to the run event log so replay/reconnect shows the pending question.
- Add an endpoint or tRPC procedure such as `POST /api/chat/runs/:runId/ui-requests/:requestId/respond`.
- The adapter promise resolves when that endpoint records an answer/cancel.
- Run cancellation resolves any pending ask as `cancelled`.
- Server restart marks the whole run failed using existing abandoned-run recovery; no question promise needs to survive a process restart.

Browser behavior:

- Render a pending question card inline near the running tool call.
- Support select/confirm/text responses, cancel, and optional "other".
- After submission, render the user's answer as part of the card/tool result; do not append it as a normal chat user message.
- Keep normal follow-up queue semantics: if the user types a separate chat message while a question is pending, it should queue behind the current run rather than answering the question accidentally.
- Replay should reconstruct pending/answered/cancelled cards from durable run events.

Testing:

- Unit-test the chat run store request lifecycle.
- Test SSE replay of pending request events.
- Browser-verify refresh/reconnect while a question is pending.

### CLI Query / Print Mode

The initial non-interactive behavior should not prompt on stdin. It should omit the adapter and let `user.ask` return:

```json
{ "status": "unavailable", "message": "Interactive UI is not available in this run." }
```

A later enhancement can add an opt-in `--interactive-questions` flag for `strata query` when stdin is a TTY.

### Scheduled Jobs / Maintenance

Scheduled runs should omit the adapter. The model should see an explicit unavailable result and either proceed conservatively or report that it needs human input. Jobs must never block indefinitely on a human prompt.

### Future Extensions

When `@strata/extensions` lands, expose the same adapter as the first subset of `ctx.ui`:

- `ctx.ui.select()` maps to the shared select request.
- `ctx.ui.confirm()` maps to confirm.
- `ctx.ui.input()` maps to text.
- `ctx.hasUI` is true only when an adapter is present.

Do not implement extension `ctx.ui.custom()` until the native ask-user path is stable across TUI and web.

## Implementation Sequence

### Slice 1: Shared Contract And Tool

1. Add shared ask/request/response types in `packages/core`.
2. Extend `ToolContext` with optional `ui`.
3. Add `packages/tools/src/userTools.ts` with `registerUserTools()` and `user.ask`.
4. Register `user.ask` in `createDefaultToolRegistry()`.
5. Add unit tests for schema validation, unavailable behavior, answered behavior with a fake adapter, cancellation, and sequential execution metadata.

### Slice 2: Agent Loop Wiring And Traceability

1. Extend `AgentRunConfig` with optional `ui`.
2. Pass a wrapped `ui` adapter into `tools.safeExecuteText()` in `executeToolCall()`.
3. The wrapper appends `agent.ui.ask.requested` and `agent.ui.ask.resolved` events to `SessionStore`.
4. Respect `AgentRunConfig.signal` while a question is pending.
5. Add agent-loop tests that `user.ask` blocks until the fake adapter resolves, then records the answer as a tool result and continues the model loop.

### Slice 3: TUI Adapter

1. Add a focused TUI question component, reusing existing picker/editor conventions where possible.
2. Add an `AgentUserInteraction` adapter to the TUI app and pass it into `runAgentLoopEvents()`.
3. Ensure pending question UI composes with existing overlays, queued messages, cancellation, and terminal-state restoration.
4. Add `FakeTerminal` tests for answer/cancel flows.

### Slice 4: Web Adapter And Browser UI

1. Add pending UI-request storage to `ChatRunStore` or a focused companion store.
2. Add web chat event variants for request/resolve if needed by the browser store.
3. Add response/cancel endpoints or tRPC procedures.
4. Pass a web `AgentUserInteraction` adapter into `runAgentLoopEvents()` from `DefaultChatService`.
5. Render pending question cards in `/chat` and wire responses back to the server.
6. Add unit tests plus live browser verification for pending-question reconnect/replay.

### Slice 5: Polish And Prompting

1. Add a concise prompt guideline to run context or tool description: use `user.ask` only when the answer materially changes the next action; otherwise make a reasonable assumption and state it.
2. Add specialized TUI/web tool rendering for completed `user.ask` results.
3. Add docs for non-interactive unavailable behavior.
4. Revisit whether `ui.ask.requested/resolved` should be promoted to first-class `AgentRunEvent` variants for every surface.

## Acceptance Criteria

- The model can call `user.ask` in TUI, the user can answer with select/confirm/text, and the answer returns as a normal tool result.
- The model can call `user.ask` in web chat, the browser renders a pending question card, refresh/reconnect preserves it, and a submitted answer resumes the same server-owned run.
- Non-interactive CLI/scheduled runs do not hang; they return an explicit unavailable result.
- Cancelling a run cancels any pending question.
- Session traces include bounded request/resolution events linked to the tool call.
- Tool-result persistence remains source-order compatible with Pi-style parallel tool execution; `user.ask` forces sequential execution for its batch.
- No answer is written to memory/wiki/todos unless the model later calls an explicit write/learning tool.

## Open Questions

- Should `strata query` grow an opt-in interactive stdin adapter, or should interactive questions remain TUI/web-only?
- Should the web prompt input be disabled while a question is pending, or should it continue accepting queued follow-up messages?
- Should `user.ask` support multi-question questionnaires in core, or should that wait for extensions once the single-question primitive is stable?
- Should `user.ask` be exposed to all tool profiles as `read`, or should Strata eventually add a distinct `interaction` tool mode?
