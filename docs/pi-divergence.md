# Where Strata Diverges from pi-mono

Strata's TUI and agent runtime are heavily inspired by [pi-mono](https://github.com/badlogic/pi-mono).
Some layers are direct ports; others are deliberate divergences. This document
records every place we depart from pi and explains why, so readers (including
future-us) can see what's intentional vs. what's an accidental drift to fix.

The audit is grouped by layer. Each row lists the strata file(s), the
corresponding pi file(s), and the rationale for any divergence.

---

## Faithful ports (1:1 with pi)

These layers track pi's logic line-for-line, with only the type-import paths
adapted to strata's package layout.

| Strata                                              | pi                                                                  | Notes                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/tui/src/keys.ts`                          | `packages/tui/src/keys.ts`                                          | `parseKey`, `decodePrintableKey`, `isKeyRelease`, all kitty/modifyOtherKeys decoders, the legacy escape table.                              |
| `packages/tui/src/stdinBuffer.ts`                   | `packages/tui/src/stdin-buffer.ts`                                  | Sequence framing, bracketed-paste extraction, kitty-printable-codepoint dedup.                                                              |
| `packages/tui/src/terminal.ts` `ProcessTerminal`    | `packages/tui/src/terminal.ts` `ProcessTerminal`                    | The kitty-protocol query → flag-7 push → 150ms modifyOtherKeys fallback. We omit Windows VT-input + cli-graphics-progress; everything else matches. |
| `packages/agent/src/compaction.ts` summary prompts  | `packages/coding-agent/src/core/compaction/{utils,compaction}.ts`   | `SUMMARIZATION_SYSTEM_PROMPT`, `SUMMARIZATION_PROMPT`, `UPDATE_SUMMARIZATION_PROMPT` are byte-identical to pi's.                            |
| `packages/tui/src/markdown.ts`                      | `packages/tui/src/components/markdown.ts`                           | Uses the same dependencies (`marked`, `cli-highlight`) and the same token rendering structure (heading / paragraph / code / list / blockquote / hr / table). Adapts pi's `MarkdownTheme` to strata's narrower `theme` API. |
| `packages/tools/src/fsTools.ts` `fs.grep` (ripgrep) | `packages/coding-agent/src/core/tools/grep.ts`                      | Shells out to `rg --json --line-number --color=never --hidden`, plus `--ignore-case` / `--fixed-strings` / `--glob` driven by tool args. Streams `match` JSON events, kills rg early at the limit, reads each matched file once for context lines. **Requires `rg` installed at runtime; pi's auto-downloader is not ported.** |

### Iteration / tool-call ceilings

Pi has no hard cap on agent iterations or tool calls — the loop ends only when
the model returns no tool calls (final answer), the model errors out, or the
user cancels. Strata now matches: `runAgentLoopEvents` is a `while (true)`
loop with the same exit conditions. `stoppedReason` is `"final_answer"`,
`"model_error"`, or `"cancelled"` — no more `"max_iterations"` /
`"max_tool_calls"`.

---

## Pi-shaped, strata's own implementation

We follow pi's UX and data shape but have written the code ourselves, usually
because the underlying machinery (e.g. pi's `AgentSession`) doesn't exist in
strata.

| Layer                       | Strata                                                                       | Pi                                                                          | Why we don't port pi directly                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Footer / StatusLine         | `packages/tui/src/app/chrome.ts`                                             | `packages/coding-agent/src/modes/interactive/components/footer.ts`          | Same data (token totals, cost, context %, model + thinking level, color thresholds) but driven by strata's `AppState.usage` rather than pi's `AgentSession`. |
| Status loader               | `packages/tui/src/components.ts` `Loader`                                     | `packages/tui/src/components/loader.ts` + `cancellable-loader.ts`           | Same UX: spinner + elapsed time + "ctrl+c to interrupt" hint. Resets on the rising edge of `state.running`.                                          |
| Tool-call rendering         | `packages/tui/src/app/transcript.ts:renderToolItem`                          | `coding-agent/src/modes/interactive/components/tool-execution.ts`           | Same visual: bold-accent name, compact arg summary in muted, indented preview (max 10 lines, `... (N more lines)` truncation hint), error code+message on red. No `⚙` / `✓` icons or `args:`/`→` labels — pi's renderer omits them. Pi additionally has Ctrl+O expand/collapse + per-tool render hooks; we don't. |
| Chat-message styling        | `packages/tui/src/app/transcript.ts:renderUserMessage` + `renderAssistantMessage` | `components/user-message.ts` + `components/assistant-message.ts`             | User messages render with a subtle background-color box (no "you" label); assistant messages render with 1-cell horizontal padding and no "strata" label. Color-only differentiation, matching pi.            |
| Autocomplete                | `packages/tui/src/editor.ts` + `app/{combinedAutocomplete,fileMentions}.ts`  | `packages/tui/src/autocomplete.ts` `CombinedAutocompleteProvider`           | Same trigger rules (`/` for commands, `@` for files). `@`-mentions now scan the whole repo via `rg --files` (pi uses `fd`; behavior is identical for our purposes — gitignore-aware, top 20 by pi's `scoreEntry` weighting: filename exact > prefix > name substring > path substring). Pi additionally handles quoted-prefix `@"path with spaces"` and arbitrary slash-command `getArgumentCompletions`; we don't yet. |
| Clipboard                   | `packages/tui/src/app/clipboard.ts`                                          | `packages/coding-agent/src/utils/clipboard.ts`                              | Same strategy (native tool first, OSC 52 for SSH/Mosh) without pi's optional native addon (`@kelvy/clipboard-native`).                              |
| Conversation continuity     | `packages/agent/src/agentLoop.ts` (`continueSessionId`)                      | `packages/agent/src/agent.ts` (`AgentSession`)                              | Same conceptual model — append-only message log, replayed forward. Pi has a 100KB+ `AgentSession` class; strata reads from its existing SQLite store. |
| Editor stays interactive while agent runs | `packages/tui/src/app/app.ts:runAgent` (no `editor.disabled` toggle) | Pi never disables the editor while streaming                                | Up/Down still browse history, typing still works. Plain Enter and Alt+Enter both queue the message — sent in order after the current run finishes. |
| Queued follow-up messages   | `packages/tui/src/app/app.ts:handleAltEnter` + `state.queuedMessages`         | `interactive-mode.ts:handleFollowUp` + `restoreQueuedMessagesToEditor`      | Same pattern. We don't yet expose pi's "restore queued messages to editor" affordance.                                                              |
| Double-escape session picker | `packages/tui/src/app/app.ts:handleEditorEscape`                              | `interactive-mode.ts` (lastEscapeTime / 500ms threshold)                    | Two Esc presses on an empty editor open the resume picker. Same threshold, same behavior.                                                            |
| Auto-compaction              | `packages/agent/src/compaction.ts:shouldAutoCompact` (75% threshold)         | Pi auto-compacts in-loop when context fills past a threshold                | Same threshold, slightly different timing — strata runs auto-compact between turns rather than mid-iteration.                                       |
| Compaction (incremental)     | `packages/agent/src/compaction.ts`                                           | `packages/coding-agent/src/core/compaction/compaction.ts`                   | Same prompts (verbatim) and same incremental-update flow when a previous summary is detected. Pi additionally does turn-prefix summarization and reserves tokens for the next reply; we don't yet (see below). |
| Session ergonomics          | `packages/tui/src/app/app.ts` `/resume`/`/clone`/`/fork`/`/name`/`/session`  | `packages/coding-agent/src/modes/interactive/...` (multiple)                | Pi has a session tree with branches and forking-at-a-message; we have flat sessions with full clone-and-switch.                                     |
| Persistent prompt history    | `packages/tui/src/app/history.ts` (`<runtimeDir>/history.jsonl`, capped at 100, stop-at-edge cycling) | In-memory only (pi's `editor.history`), with stop-at-edge cycling           | Strata *exceeds* pi here on persistence (pi's history evaporates between launches); strata matches pi's stop-at-edge behavior (Up at the oldest entry is a no-op rather than wrapping). |
| Skills as slash commands    | `/skill:<name>` auto-discovered from `.strata/skills/` at startup            | `/skill:<name>` auto-discovered from `.strata/skills/`                      | At parity. Pi additionally re-discovers on `/reload`; we don't have `/reload` yet.                                                                  |
| Startup header              | `packages/tui/src/app/header.ts` `buildStartupHeader()` pushed as a `header` transcript item at App construction | `interactive-mode.ts:566` logo + compact key-hint line + onboarding pointer in `headerContainer` | Same compact shape (`logo` / ` · `-separated key hints / dim onboarding) and same once-at-launch print. Strata emits the lines into the transcript so they scroll naturally into native terminal scrollback (pi-style scrollback model). Pi's `Ctrl+O` expanded-header toggle and update-banner are not ported. |
| `/help` screen              | Pushes a `notice` transcript item via `buildHelpNotice()`; inline, scroll-with-the-terminal | Pi has no `/help` command — same content lives in the expanded startup header (`Ctrl+O`) | Strata used to render `/help` as a centered modal that silently truncated content past `ctx.height` on short terminals. Switching to inline text matches pi's "no separate help screen" stance and removes the truncation/scrolling problem entirely. Auth/model/session selectors replace the editor area while focused, matching Pi's selector pattern. |
| Streaming assistant text    | `ModelRequest.onAssistantDelta` callback → `assistant.delta` events → `appendAssistantDelta`/`finalizeAssistantStream` | Anthropic-SDK `message_start` / `message_update` / `message_end` events with a `streamingComponent` | Same UX (text grows in the transcript as deltas arrive, finalized once at the end). Strata bridges callback-based SSE delta parsing into the async-generator agent loop via a queue. Both adapters stream: codex via `response.output_text.delta`; openai-compatible via `chat/completions` with `stream: true` + `stream_options.include_usage` and per-`index` tool-call argument accumulation, matching pi's `openai-completions.ts`. SSE framing lives in the shared `packages/agent/src/sse.ts` helper (`parseSseEvents<T>`). |

---

## fs tools — pi parity audit

All seven overlapping fs/shell tools were audited against pi. The shape and
defaults now match pi where it makes sense; strata-specific safety (repo
scope, `wiki/raw/` exclusion, symlink rejection) is preserved.

| Pi    | Strata     | Status                                                                                                                                              |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ls`  | `fs.list`  | Default `limit` raised 200 → 500. Strata adds `recursive` and `includeRaw` (strata-specific). Empty-path coerced to `.`.                            |
| `read`| `fs.read`  | Added `offset` (1-indexed start line) + `limit` (line count). Result includes `firstLine` / `lastLine` / `totalLines`. Image content unsupported (strata limitation). |
| `find`| `fs.find`  | Pattern now supports full glob: `*` is non-`/`, `**` matches any path segments, `?` is single non-`/`. Pi-aligned semantics — `*.ts` no longer matches across directories. Empty `root` coerced to `.`. |
| `grep`| `fs.grep`  | **Now shells out to ripgrep.** Schema uses `pattern` (regex by default) with `query` as alias; `ignoreCase` (canonical) with `caseSensitive` as inverse alias; new `literal` and `context: N` flags. Honors `.gitignore` automatically. `wiki/raw/` excluded as a post-filter unless `includeRaw`. |
| `bash`| `shell.run`| Empty `cwd` coerced to `.`. Strata retains explicit `cwd`/`shell`/`timeoutMs` args; pi's `bash` infers cwd.                                          |
| `write`| `fs.write`| **Defaults flipped to pi's:** `overwrite` and `createDirs` now both default to `true`. Pass `overwrite: false` / `createDirs: false` to opt out.    |
| `edit`| `fs.edit` | Multi-edit array supported — `edits: [{oldText, newText}, ...]` matched against the original file with overlap detection. Scalar `oldText`/`newText` still works for single-edit calls. Returns a unified diff in the result.                          |

---

## Strata's own (intentional divergence)

These are places where we've consciously chosen a different shape from pi.
The "Why" column is the rationale.

| Layer                         | Strata                                                                                | Pi                                                                                            | Why we diverge                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor**                    | `packages/tui/src/editor.ts` (~300 lines, single-line prompt + history + autocomplete) | `packages/tui/src/components/editor.ts` (~3000 lines, multi-line cursor, undo, kill-ring, paste markers) | Strata started simple and hasn't outgrown that yet. Big port deferred until users hit limits.                                                       |
| **Agent loop**                | `packages/agent/src/agentLoop.ts` (single generator, no extension hooks)              | `packages/agent/src/agent.ts` (`AgentSession`, retry logic, scoped-model cycling, branch summarization, extension API) | Strata has neither extensions nor scoped models. The simpler loop is easier to reason about. We can graft additional logic if/when needed.                                            |
| **Preferences**               | `packages/tui/src/app/preferences.ts` (provider/model/reasoningEffort persisted)      | Not present in pi (env-var or per-launch flags)                                               | Pi exposes far richer settings via `/settings`; strata picked the three sticky ones (model, provider, reasoning effort) and persists them so the TUI remembers across launches.       |
| **Image attachments**         | `/image <path>` slash command, data-URL transport, inline kitty/iterm2 rendering        | `Ctrl+V` clipboard-image paste, kitty/iterm graphics rendering inline in the transcript        | Multimodal works end-to-end on the model side (both adapters emit `image_url`/`input_image` parts). Inline image rendering is in place via `terminalImage.ts` (kitty + iterm2). Clipboard-image paste is the remaining gap. |
| **Schema / sessions**         | SQLite (`.strata/state.sqlite`) with `sessions`/`messages`/`events` tables            | JSONL session entries (`pi-session-*.jsonl`)                                                  | Strata uses SQLite for query-friendly session search and message lookup. Pi's append-only entries are simpler but require a full re-read for any query.                                |
| **Tool execution UX (expansion)** | One-line muted summary + colorized unified diff for `fs.edit`. No expand/collapse shortcut. | `ToolExecutionComponent` with Ctrl+O expand/collapse + per-tool render hooks                  | The render *style* is pi-aligned now. The interaction (collapse/expand) is still ours; pi's needs a key-binding plumbing layer we haven't ported.                                      |
| **TUI image rendering**       | Inline kitty/iterm2 graphics rendering via `terminalImage.ts` (PNG/JPEG dimension probing); muted text fallback elsewhere | `terminal-image.ts` (also adds GIF/WebP probing, image-id management, hyperlink helpers)         | Ported the kitty + iterm2 paths plus capability detection. GIF/WebP dimension probing and full image-id lifecycle handling are still pi-only.                                          |
| **Theme / settings UI**       | Hard-coded theme; settings via env vars                                               | `/theme`, `/settings` overlays with full theme schema                                          | Strata is single-user; theme customization isn't pulling its weight yet.                                                                                                              |
| **Session tree / fork-at**    | `/clone` and `/fork` are equivalent — duplicate the whole session                     | `/tree`, `/fork` from a specific user message                                                  | Forking-at-a-point requires a transcript-position picker UI we haven't built.                                                                                                         |
| **Compaction edge cases**     | Manual + auto-compact at 75% threshold                                                 | Pi additionally does turn-prefix summarization and reserves tokens for the response            | Both are pi-coding-agent-specific concerns (very long single turns from large diffs / file reads). Worth adding when strata tools start producing similarly large turns.              |
| **`/export`, `/share`, `/changelog`, `/reload`, `/copy <text>`, `/hotkeys`** | `/copy` (last assistant message) is in. The rest are not.                            | All present                                                                                  | Mostly nice-to-haves. Worth adding individually as needed.                                                                                                                            |
| **ripgrep auto-installer**    | Not present — fails with clear install hint when `rg` is missing                      | `ensureTool("rg")` downloads ripgrep from GitHub releases at first use                         | ~150 lines of platform-detection + tarball extraction. Skipped for now; users install via package manager.                                                                            |

---

## Strata-only tools (no pi equivalent)

These tools have no counterpart in pi-mono. They exist because strata's
domain (a personal work wiki + learning loops) is different from pi's (a
generic coding agent). Listed here so the doc is exhaustive — divergence
isn't really the right framing for them.

- `wiki.listPages` / `wiki.readPage` / `wiki.search` / `wiki.writePage` / `wiki.patchPage` / `wiki.appendLog` / `wiki.updateIndex`
- `memory.read` / `memory.write` / `memory.append`
- `todo.list` / `todo.add` / `todo.update` / `todo.remove`
- `sessions.recent` / `sessions.search`
- `skills.list` / `skills.read`

---

## Resolved issues

- **Session picker duplication on a real terminal**: a real-terminal trace
  showed the picker was emitting raw terminal control sequences stored inside
  older session titles (`ESC[99;5u`, `ESC[100;5u`, OSC title controls).
  Strata now sanitizes session titles before TUI display and strips terminal
  controls from newly generated session titles. `/sessions` remains on the
  same editor-slot selector path as model/auth selectors, keeping the code
  closer to Pi. See `docs/picker-rendering-bug.md`.

## Cleanup candidates

Items that fall under "drift, not deliberate":

- The autocomplete interface is narrower than pi's (no `argumentHint`, no `getArgumentCompletions` for arbitrary slash commands beyond `/model`). The shape is compatible — we just haven't propagated pi's full capability set.
- `Footer`'s git-branch detection re-shells out every 2 seconds; pi's `FooterDataProvider` watches for changes via fs events. Functionally equivalent for now.
- Strata has four hand-rolled copies of `optionalString` / `optionalBoolean` / `optionalInteger` (in `args.ts`, `fsTools.ts`, `wikiTools.ts`, `shellTools.ts`). The empty-path-coercion fix happened at every site individually; consolidating to a single shared helper would prevent future drift.

If something here surprises you when reading the code, it's probably worth raising — these aren't sacred decisions, just the current state.
