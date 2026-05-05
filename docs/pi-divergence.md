# Where Cortex Diverges from pi-mono

Cortex's TUI and agent runtime are heavily inspired by [pi-mono](https://github.com/badlogic/pi-mono).
Some layers are direct ports; others are deliberate divergences. This document
records every place we depart from pi and explains why, so readers (including
future-us) can see what's intentional vs. what's an accidental drift to fix.

The audit is grouped by layer. Each row lists the cortex file(s), the
corresponding pi file(s), and the rationale for any divergence.

---

## Faithful ports (1:1 with pi)

These layers track pi's logic line-for-line, with only the type-import paths
adapted to cortex's package layout.

| Cortex                                              | pi                                                                  | Notes                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/tui/src/keys.ts`                          | `packages/tui/src/keys.ts`                                          | `parseKey`, `decodePrintableKey`, `isKeyRelease`, all kitty/modifyOtherKeys decoders, the legacy escape table.                              |
| `packages/tui/src/stdinBuffer.ts`                   | `packages/tui/src/stdin-buffer.ts`                                  | Sequence framing, bracketed-paste extraction, kitty-printable-codepoint dedup.                                                              |
| `packages/tui/src/terminal.ts` `ProcessTerminal`    | `packages/tui/src/terminal.ts` `ProcessTerminal`                    | The kitty-protocol query → flag-7 push → 150ms modifyOtherKeys fallback. We omit Windows VT-input + cli-graphics-progress; everything else matches. |
| `packages/agent/src/compaction.ts` summary prompts  | `packages/coding-agent/src/core/compaction/{utils,compaction}.ts`   | `SUMMARIZATION_SYSTEM_PROMPT`, `SUMMARIZATION_PROMPT`, `UPDATE_SUMMARIZATION_PROMPT` are byte-identical to pi's.                            |
| `packages/tui/src/markdown.ts`                      | `packages/tui/src/components/markdown.ts`                           | Uses the same dependencies (`marked`, `cli-highlight`) and the same token rendering structure (heading / paragraph / code / list / blockquote / hr / table). Adapts pi's `MarkdownTheme` to cortex's narrower `theme` API. |

---

## Pi-shaped, cortex's own implementation

We follow pi's UX and data shape but have written the code ourselves, usually
because the underlying machinery (e.g. pi's `AgentSession`) doesn't exist in
cortex.

| Layer                       | Cortex                                                                       | Pi                                                                          | Why we don't port pi directly                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Footer / StatusLine         | `packages/tui/src/app/chrome.ts`                                             | `packages/coding-agent/src/modes/interactive/components/footer.ts`          | Same data (token totals, cost, context %, model + thinking level, color thresholds) but driven by cortex's `AppState.usage` rather than pi's `AgentSession`. |
| Autocomplete                | `packages/tui/src/editor.ts` + `app/{combinedAutocomplete,fileMentions}.ts`  | `packages/tui/src/autocomplete.ts` `CombinedAutocompleteProvider`           | Same trigger rules (`/` for commands, `@` for files). Pi's interface includes scoped-models, fd-based path completion, quoted prefixes; we have only `@`-mention against `wiki/` and slash-commands. |
| Clipboard                   | `packages/tui/src/app/clipboard.ts`                                          | `packages/coding-agent/src/utils/clipboard.ts`                              | Same strategy (native tool first, OSC 52 for SSH/Mosh) without pi's optional native addon (`@kelvy/clipboard-native`).                              |
| Conversation continuity     | `packages/agent/src/agentLoop.ts` (`continueSessionId`)                      | `packages/agent/src/agent.ts` (`AgentSession`)                              | Same conceptual model — append-only message log, replayed forward. Pi has a 100KB+ `AgentSession` class; cortex reads from its existing SQLite store. |
| Session ergonomics          | `packages/tui/src/app/app.ts` `/resume`/`/clone`/`/fork`/`/name`/`/session`  | `packages/coding-agent/src/modes/interactive/...` (multiple)                | Pi has a session tree with branches and forking-at-a-message; we have flat sessions with full clone-and-switch.                                     |
| Compaction                  | `packages/agent/src/compaction.ts`                                           | `packages/coding-agent/src/core/compaction/compaction.ts`                   | Same prompts and incremental-update flow + auto-compaction at threshold. Pi additionally does turn-prefix summarization and reserves tokens for the next reply; we don't yet (see below). |

---

## Cortex's own (intentional divergence)

These are places where we've consciously chosen a different shape from pi.
The "Why" column is the rationale.

| Layer                         | Cortex                                                                                | Pi                                                                                            | Why we diverge                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor**                    | `packages/tui/src/editor.ts` (~300 lines, single-line prompt + history + autocomplete) | `packages/tui/src/components/editor.ts` (~3000 lines, multi-line cursor, undo, kill-ring, paste markers) | Cortex started simple and hasn't outgrown that yet. Big port deferred until users hit limits. Tracked separately as a future "port pi's editor" task. |
| **Agent loop**                | `packages/agent/src/agentLoop.ts` (single generator, no extension hooks)              | `packages/agent/src/agent.ts` (`AgentSession`, retry logic, scoped-model cycling, branch summarization, extension API) | Cortex has neither extensions nor scoped models. The simpler loop is easier to reason about. We can graft additional logic if/when needed.                                            |
| **Persistent prompt history** | `packages/tui/src/app/history.ts` (`<runtimeDir>/history.jsonl`, capped at 100)       | In-memory only (pi's editor.history)                                                          | Cortex *exceeds* pi here. Pi's history evaporates between launches; we persist to disk so up-arrow recall survives `cortex tui` restarts.                                            |
| **Preferences**               | `packages/tui/src/app/preferences.ts` (provider/model/reasoningEffort persisted)      | Not present in pi (env-var or per-launch flags)                                               | Pi exposes far richer settings via `/settings`; cortex picked the three sticky ones (model, provider, reasoning effort) and persists them so the TUI remembers across launches.       |
| **Image attachments**         | `/image <path>` slash command, data-URL transport                                     | `Ctrl+V` clipboard-image paste, kitty/iterm graphics rendering inline in the transcript        | Multimodal works end-to-end on the model side (both adapters emit `image_url`/`input_image` parts). Clipboard-image paste and inline TUI image rendering are deferred — biggest follow-up. |
| **Schema / sessions**         | SQLite (`.cortex/state.sqlite`) with `sessions`/`messages`/`events` tables            | JSONL session entries (`pi-session-*.jsonl`)                                                  | Cortex uses SQLite for query-friendly session search and message lookup. Pi's append-only entries are simpler but require a full re-read for any query.                                |
| **Tool execution UX**         | Transcript shows a one-line muted summary of each tool result                         | `ToolExecutionComponent` with expand/collapse (`Ctrl+O`), per-tool render hooks                | Pi's tool rendering is far richer. Cortex's is sufficient for the wiki tools we ship today. Worth porting once we have heavy tool output (e.g. file diffs).                            |
| **TUI image rendering**       | Image attachments shown as `queued image: foo.png (12KB)`                             | `terminal-image.ts` renders via kitty / iterm2 graphics protocols                              | We don't render pixels in the transcript. Adding this is gated on porting `terminal-image.ts` (~700 lines + protocol detection).                                                       |
| **Theme / settings UI**       | Hard-coded theme; settings via env vars                                               | `/theme`, `/settings` overlays with full theme schema                                          | Cortex is single-user; theme customization isn't pulling its weight yet.                                                                                                              |
| **Skills as slash commands**  | None                                                                                  | `/skill:<name>` auto-discovered from `.cortex/skills/`                                         | Cortex has skills storage but doesn't expose them as commands yet. Small follow-up.                                                                                                   |
| **Session tree / fork-at**    | `/clone` and `/fork` are equivalent — duplicate the whole session                     | `/tree`, `/fork` from a specific user message                                                  | Forking-at-a-point requires a transcript-position picker UI we haven't built.                                                                                                         |
| **Compaction edge cases**     | Manual + auto-compact (75% threshold)                                                 | Pi additionally does turn-prefix summarization and reserves tokens for the response            | Both are pi-coding-agent-specific concerns (very long single turns from large diffs / file reads). Worth adding when cortex tools start producing similarly large turns.              |
| **`/export`, `/share`, `/changelog`, `/reload`, `/copy <text>`, `/hotkeys`** | None                                                                                  | All present                                                                                  | Mostly nice-to-haves. Worth adding individually as needed.                                                                                                                            |

---

## Cleanup candidates

Items that fall under "drift, not deliberate":

- The autocomplete interface is narrower than pi's (no `argumentHint`, no `getArgumentCompletions` for arbitrary slash commands beyond `/model`). The shape is compatible — we just haven't propagated pi's full capability set.
- `Footer`'s git-branch detection re-shells out every 2 seconds; pi's `FooterDataProvider` watches for changes via fs events. Functionally equivalent for now.

If something here surprises you when reading the code, it's probably worth raising — these aren't sacred decisions, just the current state.
