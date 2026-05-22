# Strata TUI Plan

Status: planned.

This plan updates the previous TUI direction: Strata should implement the TUI stack end-to-end in this repo. Pi remains the reference implementation for architecture and behavior, but Strata should not depend on `@mariozechner/pi-tui` for the first-party learning path.

The target is a clean, small, auditable TUI that starts with the pieces Strata actually needs: chat transcript, prompt editor, tool-call visualization, auth/login UI, model/provider status, sessions, and slash commands.

## 1. Reference Findings From Pi

Pi's TUI quality comes from two separate layers:

1. A reusable low-level TUI package with terminal lifecycle, input handling, rendering, focus, overlays, text/editor widgets, autocomplete, and markdown rendering.
2. A large interactive-mode controller that wires the TUI to the agent runtime, streaming events, auth, model selection, sessions, settings, and tool rendering.

Patterns worth adapting:

- Component contract: `render(width): string[]`, optional `handleInput`, optional invalidation. Components are simple and width-bound.
- Focus model: only one focused component receives input; focusable components expose a `focused` flag and render a cursor marker for correct hardware cursor placement.
- Runtime ownership: one `TuiRuntime` owns the terminal, render scheduling, focus, overlays, input dispatch, resize handling, and shutdown cleanup.
- Differential rendering: render the full component tree into logical lines, compare with the previous frame, then only redraw changed regions.
- Editor behavior: multiline prompt, history navigation, bracketed paste, sane submit/newline behavior, autocomplete, and large-paste markers.
- Overlay/dialog behavior: selectors and auth dialogs are focusable components that temporarily replace or overlay the editor and then restore focus.
- Event-driven agent UI: the agent emits message/tool/status lifecycle events; the UI maps those events into components and invalidates render state.

Patterns to avoid or defer:

- Do not create a single giant interactive-mode class. Pi's controller is powerful, but Strata should split controller, state reducer, command registry, components, and runtime bindings.
- Do not implement extensions, custom UI plugin APIs, terminal image protocols, theme hot reload, full settings UI, keybinding customization, session tree/fork flows, or compaction UI in the first pass.
- Do not copy pi code wholesale. Reimplement the core ideas in smaller Strata-specific modules.

Useful local reference points:

- `/home/exedev/Documents/pi-mono/packages/tui/src/tui.ts`: component model, focus, overlays, diff rendering.
- `/home/exedev/Documents/pi-mono/packages/tui/src/terminal.ts`: raw-mode lifecycle, bracketed paste, resize cleanup, keyboard protocol handling.
- `/home/exedev/Documents/pi-mono/packages/tui/src/components/editor.ts`: multiline editor, cursor marker, wrapping, history, paste, autocomplete.
- `/home/exedev/Documents/pi-mono/packages/tui/src/autocomplete.ts`: slash-command and path autocomplete provider contract.
- `/home/exedev/Documents/pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts`: app layout, event-to-component mapping, key handlers, auth/model/session flows.
- `/home/exedev/Documents/pi-mono/packages/coding-agent/src/modes/interactive/components/login-dialog.ts`: OAuth dialog flow.
- `/home/exedev/Documents/pi-mono/packages/coding-agent/src/modes/interactive/components/oauth-selector.ts`: provider selector structure.

## 2. Strata Design Goals

- First-party implementation: all low-level terminal, input, renderer, editor, and app code lives under `packages/tui`.
- Small surface area: implement only the terminal features needed for Strata's agent harness first.
- Separable layers: low-level TUI primitives should not import `@strata/agent`; Strata app components can import agent/core/tools packages.
- Render purity: components render from state; controller code mutates state and requests renders.
- Strict width discipline: every rendered line must fit terminal width after ANSI escape codes are ignored.
- Graceful terminal cleanup: raw mode, cursor visibility, bracketed paste, resize handlers, and pending timers must always restore on exit.
- Testable without a real terminal: use a fake terminal for render/input tests.

## 3. Package Layout

Add a new workspace package:

```text
packages/tui/
  package.json
  tsconfig.json
  src/
    index.ts
    terminal/
      terminal.ts
      processTerminal.ts
      escape.ts
      inputBuffer.ts
      keyParser.ts
      signals.ts
    render/
      component.ts
      runtime.ts
      reconciler.ts
      focus.ts
      overlay.ts
      frame.ts
      width.ts
      ansi.ts
      theme.ts
    components/
      box.ts
      container.ts
      dynamicBorder.ts
      editor.ts
      input.ts
      loader.ts
      markdown.ts
      selectList.ts
      spacer.ts
      text.ts
      truncatedText.ts
    app/
      runTui.ts
      strataApp.ts
      appState.ts
      appReducer.ts
      appEvents.ts
      commandRegistry.ts
      modelFactory.ts
      keymap.ts
      components/
        authDialog.ts
        authSelector.ts
        assistantMessage.ts
        footer.ts
        helpOverlay.ts
        sessionSelector.ts
        statusLine.ts
        toolCall.ts
        userMessage.ts
```

Keep `terminal/`, `render/`, and generic `components/` independent of Strata domain packages. Only `app/` should depend on `@strata/agent`, `@strata/core`, and `@strata/tools`.

## 4. Low-Level TUI Architecture

### 4.1 Terminal Interface

Create a minimal terminal abstraction:

```ts
export interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  write(data: string): void;
  drainInput(maxMs?: number, idleMs?: number): Promise<void>;
  readonly columns: number;
  readonly rows: number;
  hideCursor(): void;
  showCursor(): void;
  clearScreen(): void;
  setTitle(title: string): void;
  setProgress(active: boolean): void;
}
```

`ProcessTerminal` responsibilities:

- Save and restore existing raw-mode state.
- Enable raw mode and UTF-8 input.
- Enable and disable bracketed paste mode.
- Register and unregister resize handlers.
- Hide/show cursor on lifecycle transitions.
- Drain late input before exit to avoid leaking escape sequences into the shell.
- Provide optional synchronized output wrappers (`CSI ?2026 h/l`) when writing frames.

Defer Kitty CSI-u and xterm `modifyOtherKeys` until the basic legacy-key parser is stable. Add the parser seam immediately so advanced keyboard protocols can be added without changing components.

### 4.2 Input Buffer And Key Parser

Implement first-party input handling in two layers:

- `InputBuffer`: splits raw stdin chunks into complete events, preserving bracketed paste blocks.
- `keyParser`: converts known sequences into typed key ids such as `enter`, `shift+enter`, `escape`, `ctrl+c`, `ctrl+d`, `up`, `down`, `left`, `right`, `tab`, `backspace`, `delete`, and printable text.

Components should receive a normalized `InputEvent`, not arbitrary raw strings:

```ts
export type InputEvent =
  | { type: "key"; key: KeyId; raw: string }
  | { type: "text"; text: string; raw: string }
  | { type: "paste"; text: string; raw: string };
```

This is cleaner than pi's raw-string component input and makes tests easier. Keep `raw` for debugging and for future protocol support.

### 4.3 Component System

Use a small component contract:

```ts
export interface Component {
  render(ctx: RenderContext): Frame;
  handleInput?(event: InputEvent): InputResult;
  invalidate?(): void;
}

export interface Focusable {
  focused: boolean;
}
```

`Frame` should be a structured object rather than a raw `string[]` during internal rendering:

```ts
export interface Frame {
  lines: string[];
  cursor?: { row: number; col: number };
}
```

The runtime can still diff and write strings, but keeping cursor position structured avoids embedding magic cursor-marker strings in most components. The editor/input components can return cursor coordinates directly.

### 4.4 Rendering And Reconciliation

`TuiRuntime` responsibilities:

- Own a root `Container`.
- Track current focus.
- Track overlay stack.
- Schedule renders at a capped cadence, initially 16ms minimum interval.
- Render root and overlays into a full logical frame.
- Validate line widths before writing.
- Diff current frame against previous frame.
- Write changed lines using ANSI cursor movement and synchronized output.
- Force full redraw on width changes.
- Restore terminal state on shutdown.

Start with a deliberately simple reconciler:

1. First frame writes the whole frame.
2. Width changes force clear-screen full redraw.
3. Otherwise compare line-by-line.
4. If changed lines are contiguous and visible, redraw the changed range.
5. If deletion or viewport math gets complicated, fall back to full redraw.

Pi's renderer is highly optimized. Strata should first be correct and debuggable, then optimize.

### 4.5 Width And ANSI Utilities

Implement first-party utilities:

- `stripAnsi(text)`.
- `visibleWidth(text)`.
- `truncateToWidth(text, width, ellipsis)`.
- `wrapText(text, width)`.
- `padToWidth(text, width)`.
- `sliceByWidth(text, width)`.

For `visibleWidth`, start with:

- ANSI escape sequences count as zero.
- Combining marks count as zero.
- Common CJK/fullwidth ranges count as two.
- Everything else counts as one.

This is good enough for v1 and avoids pulling in a width dependency. Add tests for ANSI styling, emoji-ish cases, CJK, combining marks, and truncation.

### 4.6 Styling And Theme

Implement a tiny ANSI styling layer:

```ts
theme.accent(text)
theme.muted(text)
theme.error(text)
theme.warning(text)
theme.success(text)
theme.dim(text)
theme.bold(text)
theme.inverse(text)
```

No theme config in v1. Pick a restrained default palette and keep all styling centralized.

## 5. Generic Components

Build these in order:

1. `Container`: vertical composition.
2. `Text`: wrapping multi-line text with padding.
3. `TruncatedText`: single-line text.
4. `Spacer`: fixed empty rows.
5. `DynamicBorder`: width-aware horizontal rule.
6. `Box`: padded container with optional border/background.
7. `Input`: single-line editable input.
8. `SelectList`: searchable list component with selected index.
9. `Loader`: simple spinner controlled by runtime timer.
10. `Markdown`: narrow first-party renderer for paragraphs, headings, lists, inline code, fenced code, and links.
11. `Editor`: multiline prompt editor.

Editor v1 requirements:

- Multiline text buffer.
- Enter submits; Shift+Enter inserts newline where supported.
- Backslash+Enter inserts newline fallback.
- Arrow navigation.
- Backspace/delete.
- Ctrl+A/Ctrl+E, Ctrl+W, Ctrl+U, Ctrl+K.
- Prompt history with up/down when on first/last visual line.
- Bracketed paste handling.
- Large paste marker replacement with expansion on submit.
- Slash-command autocomplete.
- File/path autocomplete can be deferred until after slash commands.

## 6. Strata App TUI

Add `strata tui` as a CLI command and root script.

Launch flags follow Pi's session ergonomics: `--continue`/`-c` resumes the most recent session, `--resume`/`-r` opens the session picker, `--session <id-prefix>` resumes a specific session, and `--fork <id-prefix>` clones a specific session before opening it.

Initial layout:

```text
Header
ChatTranscript
StatusLine
Editor
Footer
```

Header:

- Show `strata`, version, active provider/model, and short key hints.
- Keep it collapsible later, but static for v1.

Chat transcript:

- User messages.
- Assistant messages rendered as simple markdown.
- Tool calls rendered as status cards.
- Tool results rendered as compact summaries with optional expanded state.
- Error/status messages as dim or colored transcript rows.

Editor:

- Always focused during normal chat.
- Disabled or visually marked while a request is running.
- Supports slash-command autocomplete.

Footer:

- Repo path shortened to `~`.
- Provider and model.
- Auth status.
- Session id when a session exists.
- Last run status, iterations, and tool count.

## 7. Agent Event Integration

The current `runAgentLoop()` returns only a final result. A TUI needs lifecycle events.

Add an event-producing API in `@strata/agent`:

```ts
export type AgentRunEvent =
  | { type: "session.started"; sessionId: string; title: string; model: string }
  | { type: "message.user"; content: string }
  | { type: "model.request"; iteration: number; messageCount: number }
  | { type: "model.response"; iteration: number; content: string; toolCalls: AgentToolCall[] }
  | { type: "tool.call.started"; toolCallId: string; toolName: string; argumentsText: string }
  | { type: "tool.call.completed"; toolCallId: string; result: ToolExecutionResult }
  | { type: "agent.completed"; result: AgentRunResult }
  | { type: "agent.failed"; message: string };

export async function* runAgentLoopEvents(config: AgentRunConfig): AsyncGenerator<AgentRunEvent>;
```

Then keep the existing `runAgentLoop()` as a wrapper that consumes events and returns the final result. This avoids duplicate loop logic and lets CLI query behavior remain stable.

Streaming model deltas are not required for the first TUI cut because current model adapters complete whole responses. The UI can still show "Thinking..." during `model.request` and append the assistant response on `model.response`. Later, add model adapter streaming events without changing the app controller shape.

## 8. Commands And Keymap

First slash commands:

- `/help`: show help overlay.
- `/login`: launch ChatGPT auth flow in a TUI dialog.
- `/logout`: clear ChatGPT credentials.
- `/auth`: show auth status.
- `/model [name]`: set model for current TUI session.
- `/tools`: list registered tools.
- `/sessions`: show recent sessions selector; `Ctrl+D` inside the selector starts delete confirmation.
- `/clear`: clear visible transcript, not stored history.
- `/quit`: exit cleanly.

First keymap:

- `Enter`: submit.
- `Shift+Enter`: newline if terminal reports it.
- `\` + `Enter`: newline fallback.
- `Ctrl+C`: clear editor or interrupt active run; second press exits.
- `Ctrl+D`: exit if editor is empty; delete the selected session when the session selector is focused.
- `Esc`: close overlay/autocomplete; interrupt active run later.
- `Tab`: autocomplete.
- `Ctrl+L`: force redraw.
- `Ctrl+R`: session selector later.

Keep keybindings hardcoded in v1. Add config only after behavior stabilizes.

## 9. Auth UI

Use the existing ChatGPT OAuth implementation from `@strata/agent`.

TUI-specific components:

- `AuthSelector`: one option initially, `openai-codex`.
- `AuthDialog`: shows auth URL, progress messages, manual redirect input, cancel.
- `AuthStatusLine`: summarized provider state.

Flow:

1. User enters `/login`.
2. App replaces editor or opens centered overlay with `AuthDialog`.
3. Existing `loginChatGpt()` callbacks update dialog content.
4. Browser open is attempted with platform command.
5. Manual paste is supported via dialog input.
6. Success restores editor focus and updates footer/auth status.
7. Cancel aborts the OAuth flow and restores editor focus.

## 10. State Management

Avoid a monolithic interactive class by using a reducer:

```ts
export interface AppState {
  provider: "openai-codex" | "openai-compatible";
  model: string;
  authStatus: AuthStatusSummary;
  currentSessionId?: string;
  running: boolean;
  transcript: TranscriptItem[];
  status?: string;
  toolExpanded: boolean;
}
```

Controller responsibilities:

- Parse editor submissions.
- Dispatch slash commands.
- Start agent runs.
- Consume `AgentRunEvent`.
- Dispatch reducer actions.
- Request TUI renders.
- Handle shutdown and terminal cleanup.

Components receive `AppState` snapshots or narrow props. They should not call model/auth/session APIs directly.

## 11. Testing Strategy

Low-level tests:

- ANSI stripping, visible width, wrapping, truncation.
- Input buffer splitting.
- Key parser known sequences.
- Reconciler output for simple frame changes.
- Focus transitions and overlay stack.

Component tests:

- `Text`, `TruncatedText`, `Box`, `SelectList`, `Markdown`, `Editor` render snapshots at fixed widths.
- Editor input behavior: submit, newline, backspace, paste, history, autocomplete.

App tests:

- Slash command parser.
- App reducer.
- Agent event to transcript mapping.
- Fake auth dialog callback flow.
- Fake terminal integration: submit question, receive fake events, render transcript.

Use `bun test`. Do not require a real terminal in CI-style tests.

## 12. Milestones

### Phase 1: Terminal And Renderer Foundation

- Add `packages/tui`.
- Implement terminal abstraction and fake terminal.
- Implement ANSI/width utilities.
- Implement component contract, container, focus, runtime, simple full-frame renderer.
- Implement first diff renderer after full-frame correctness.
- Add tests for utilities and render lifecycle.

Acceptance:

- `strata tui` can start, render a static header/body/footer, react to resize, and exit cleanly.
- Terminal state is restored after normal exit and thrown errors.

### Phase 2: Prompt Editor And Commands

- Implement `Input`, `Editor`, `SelectList`, `Text`, `Markdown`, `Loader`.
- Implement key parser enough for editor use.
- Implement slash command registry and autocomplete.
- Add `/help`, `/clear`, `/quit`, `/auth`.

Acceptance:

- TUI can accept multiline input, maintain history, show command autocomplete, and execute local commands without an agent run.

### Phase 3: Agent Event API

- Add `runAgentLoopEvents()`.
- Refactor `runAgentLoop()` to consume the event API.
- Preserve existing CLI query behavior.
- Add event tests.

Acceptance:

- Existing CLI tests pass.
- Fake TUI can consume agent lifecycle events without needing a real model.

### Phase 4: Chat TUI

- Implement app controller/reducer.
- Implement transcript components for user, assistant, tool call, status, and error items.
- Wire editor submit to `runAgentLoopEvents()`.
- Render model request/loading status and final responses.

Acceptance:

- `strata tui` can ask a wiki query through the existing ChatGPT auth/model adapter and show tool calls/results in the transcript.

### Phase 5: Auth And Sessions

- Implement `/login` and `/logout` dialogs.
- Implement session list selector using `SessionStore.listSessions()`.
- Add footer session/model/auth details.

Acceptance:

- User can log in, log out, ask a question, and inspect recent sessions entirely inside the TUI.

### Phase 6: Polish And Hardening

- Add partial redraw reconciliation.
- Add Ctrl+C interrupt semantics.
- Add forced redraw/debug dump.
- Improve Markdown rendering and tool-card expansion.
- Add path autocomplete.
- Add optional advanced keyboard protocol support.

Acceptance:

- The TUI feels responsive under long transcripts and survives terminal resize, failed auth, model errors, and abrupt cancellation.

## 13. Immediate Next Step

Implement Phase 1 with the smallest useful vertical slice:

1. Create `packages/tui`.
2. Add `Terminal`, `FakeTerminal`, and `ProcessTerminal`.
3. Add `Component`, `Container`, `Text`, `Spacer`, `DynamicBorder`.
4. Add `TuiRuntime` with full-frame rendering and clean shutdown.
5. Add `strata tui` that renders a static shell and exits on `Ctrl+D` or `/quit` once the editor exists in Phase 2.

This establishes the low-level foundation without mixing it with agent complexity too early.
