# Strata Web Feature Parity Plan

Status: complete. Subordinate to [roadmap.md](./roadmap.md), [web-chat-plan.md](./web-chat-plan.md), and [tui-plan.md](./tui-plan.md).

This plan covers porting the high-value composer features that already exist in the TUI (file `@`-mentions, model picker, slash commands, prompt history) to the local browser chat in `apps/web`. It is the "next web-chat depth" work after the second web-chat milestone is otherwise usable.

## Objective

Make the web chat composer feel as fluent as the TUI for power users:

- Insert references to files in the repo with `@`-mention autocomplete.
- Pick the active model and reasoning effort from the composer.
- Fire slash commands that act on the chat (clear, fork, model picker, etc.).
- Recall earlier prompts with the up/down arrows.

The web should reuse the same data (file enumeration, model list) that the TUI already produces and serve them through the existing `packages/web-api` boundary. The web should not fork a separate file-search or model-listing implementation.

## Non-Goals

- Do not share the autocomplete *rendering* between TUI and web. Their layout and keyboard models differ; the win is a shared *data contract*, not a shared component tree.
- Do not implement the kitchen-sink upstream `ai-elements/prompt-input` (dropdown menus, hover cards, command palette, tabs). Strata's bespoke `PromptInput` should grow these features in place.
- Do not introduce a server-side preferences store for the chosen model yet. Local browser persistence (`localStorage`) is enough until TUI and web prefs need to converge.
- Do not block on connector control-plane work. Feature parity is a chat-composer slice; connector work resumes after.

## Existing TUI Surface To Mirror

The web should match the user-visible behavior of these TUI pieces:

- `packages/tui/src/editor.ts` — `AutocompleteProvider` contract: `provide(text, cursor) -> { items, replaceStart, replaceEnd } | undefined`. Items have `label`, `value`, optional `description`. The cursor-position-aware `replaceStart`/`replaceEnd` lets the same provider serve `@file` mentions (replace the active `@…` token) and `/command` triggers (replace the whole line).
- `packages/tui/src/app/fileMentions.ts` — `FileMentionProvider`: shells out to `rg --files --hidden --glob '!.git/**'` from the repo root, derives directory entries from each file's parent chain so users can complete to folders, scores results by Pi's `scoreEntry` (exact filename = 100, prefix = 80, name substring = 50, path substring = 30, +10 directory bonus), caches the entry list with a 5s TTL, and returns up to 20 items.
- `packages/tui/src/app/modelSelector.ts` and `packages/tui/src/app/modelFactory.ts` — `listModels(provider, signal)` calls Codex (`/codex/models`) or OpenAI-compatible (`/v1/models`) and returns `{ id, description }[]`. The TUI surfaces them in an inline picker; the choice is persisted in `~/.strata/preferences.json` and applied to the active adapter via `createModelAdapter`.
- `packages/tui/src/app/history.ts` — prompt history is a JSONL log under the runtime dir (one entry per line, deduped against the previous entry). The editor's up/down arrow keys recall entries.
- `packages/tui/src/app/combinedAutocomplete.ts` — composes multiple providers (slash commands + file mentions) into a single dispatch chain. The web version should adopt the same idea: providers are tiny modules; the composer asks them in order until one returns suggestions.

The model factory refactor is now complete for shared data sources: `defaultModel`, `inferDefaultProvider`, `parseModelProvider`, `createModelAdapter`, and `listModels` live in `packages/agent/src/modelFactory.ts` and are consumable by CLI, TUI, and `packages/web-api`. `loadAuthStatus` remains TUI-shaped under `packages/tui/src/app/modelFactory.ts`.

## Architecture

Three layers, three phases.

### Layer 1 — Shared data sources

Move the data-producing logic into the package whose name matches its concern, so any frontend (TUI, web, future) can consume it the same way.

- **`@strata/agent`** owns `listModels(provider, signalOrOptions?) -> ModelInfo[]`. This is a network call, not UI, and lives next to the model-adapter factory. `loadAuthStatus` remains TUI-shaped unless the web later needs the same summary.
- **`@strata/core`** gains `findRepoFiles({ query, repoRoot, limit }) -> RepoFileEntry[]`. The function:
  - Runs `rg --files --hidden --glob '!.git/**'` once and caches the result with a TTL (same 5s as the TUI). The cache is module-scoped and keyed by `repoRoot`.
  - Derives directory entries from each file's parent chain.
  - Scores entries against `query` using the existing `scoreEntry` algorithm.
  - Returns up to `limit` entries (default 20).
  - Returns an empty array when `rg` is missing or fails — never throws.
- **`packages/tui/src/app/fileMentions.ts`** is a thin `AutocompleteProvider` wrapper around `findRepoFiles`. The `@`-token gating logic stays in the TUI wrapper; file enumeration, scoring, TTL caching, and safe failure behavior live in `@strata/core`.
- **`packages/tui/src/app/modelFactory.ts`** re-exports `listModels`, `defaultModel`, and `inferDefaultProvider`, and keeps TUI-only `loadAuthStatus`/`createModelAdapter` helpers.

This is the only refactor work that touches existing tested code paths. All TUI tests continue to pass; the moves are pure relocations of existing logic.

### Layer 2 — Web-api endpoints

Two thin tRPC procedures, both stateless reads:

- `chat.files.list({ query: string; limit?: number }) -> { entries: { path: string; isDirectory: boolean }[] }`. Wraps `findRepoFiles`. Lives next to the existing `chat.sessions.*` procedures.
- `chat.models.list({ provider: ModelProviderName }) -> { models: { id: string; description: string }[] }`. Wraps `listModels`. Surfaces the same provider names as `chat.models.status`.

Both procedures are read-only and side-effect-free. `chat.files.list` is called through the web autocomplete debounce path, and `findRepoFiles` keeps its repo-root keyed TTL cache. The shared `SessionStore` is unchanged.

### Layer 3 — Web composer integration

A small set of web-only primitives in `apps/web/src/lib/`:

- **`useAutocomplete(textareaRef, providers)`** — generic hook. Listens for `input`, `keydown` (Up/Down/Enter/Escape/Tab), and selection changes on the bound textarea. Calls each provider in order until one returns suggestions. Returns `{ open, items, selectedIndex, anchorRect, accept, dismiss }` for a popover component to render. The popover is anchored to the textarea's caret rectangle (computed via a tiny offscreen mirror, the standard react-textarea-autosize-style trick). Accepted and dismissed suggestions stay closed until the active value/caret changes, matching the TUI's non-reopening behavior.
- **`fileMentionProvider`** — concrete provider. Detects `@<token>` immediately preceded by start-of-line or whitespace/`(`/`[`/`{`/`<`/`,`/`;`. Calls `chat.files.list` through the hook debounce path. Returns `{ items, replaceStart, replaceEnd }`. The `value` is `@path` for files and `@path/` for directories — same as the TUI.
- **`slashCommandProvider`** — concrete provider. Pure client-side static list: `/clear`, `/fork`, `/model`, `/help`. Triggers when the textarea content starts with `/`. Selecting `/model` opens the model picker dropdown described below; the others dispatch directly.
- **`useChatModelChoice()`** — stores the chosen `{ provider, model, reasoningEffort }` in `localStorage` under `strata:chat:model`. Reads default from `chat.models.status`. The choice rides on every `startChatRun(input)` via the existing `StartChatRunRequest` `model`/`provider`/`reasoningEffort` fields, so no backend change is needed.
- **`useChatPromptHistory()`** — stores up to N prior submitted prompts in `localStorage` under `strata:chat:prompts`. Up arrow on empty/start-of-input recalls earlier entries; down arrow walks forward. Same dedup-against-previous behavior as the TUI.

The composer surface in `apps/web/src/components/ai-elements/prompt-input.tsx` grows two visible additions:

- A small **model dropdown** above the textarea, populated by `chat.models.list`. Shows the current model id; expanding it lists provider/model pairs grouped by provider. Selection updates the local choice and rides on the next submit.
- A **suggestion popover** rendered above the textarea when the autocomplete hook reports `open: true`. The popover is keyboard-driven (arrow keys, Enter to accept, Escape to dismiss); it uses the same shadcn `Command`-style item list AI Elements already brings in via `button-group`.

Slash commands and prompt history don't add new visual surface — they're driven entirely by composer state.

## Sequencing

Three phases, each independently shippable.

### Phase 1 — Refactor (complete)

1. `listModels` moved from `packages/tui/src/app/modelFactory.ts` into `packages/agent/src/modelFactory.ts`, with a TUI re-export preserving the existing import path.
2. `findRepoFiles` now lives in `packages/core/src/repoFiles.ts` and is exported as `@strata/core/repo-files`. It owns the `rg --files --hidden --glob '!.git/**'` enumeration, directory derivation, scoring, TTL cache, and safe empty-list fallback.
3. `packages/tui/src/app/fileMentions.ts` now consumes `findRepoFiles` while keeping the public `FileMentionProvider` shape and `@`-token gating behavior.
4. Unit coverage now lives at the shared seams: `packages/core/src/repoFiles.test.ts` covers file enumeration/scoring and `packages/agent/src/modelFactory.test.ts` covers Codex/OpenAI-compatible model listing.

### Phase 2 — Endpoints + autocomplete primitive + file mentions (complete)

1. `chat.files.list` and `chat.models.list` now live in `packages/web-api/src/services.ts` and `packages/web-api/src/trpc.ts`.
2. `apps/web/src/lib/api.ts` now exposes `listChatFiles(query, limit)` and `listChatModels(provider)`.
3. `apps/web/src/lib/useAutocomplete.ts` owns the reusable provider contract, async provider dispatch, keyboard navigation, accept/dismiss behavior, and caret rectangle calculation. `apps/web/src/components/autocomplete-popover.tsx` renders the Strata-themed suggestion list.
4. `apps/web/src/lib/fileMentionProvider.ts` backs file suggestions with `chat.files.list`, and `PromptInput` wires it through `autocompleteProviders`.
5. Browser verification on 2026-05-09 covered `@web` suggestions in `/chat`, ArrowDown selection, Tab accept-to-textarea, and Escape dismissal. The focused backend/provider tests cover both new tRPC procedures and file mention token/item mapping.

### Phase 3 — Model picker, slash commands, prompt history (complete)

1. `apps/web/src/lib/useChatModelChoice.ts` reads defaults from `chat.models.status`, populates provider groups from `chat.models.list`, persists `{ provider, model, reasoningEffort }` in `localStorage`, and `ChatPage` sends those fields on every `startChatRun` call.
2. `apps/web/src/components/chat-model-picker.tsx` adds the compact composer dropdown without disrupting attachment/send controls. It groups models by provider and exposes the reasoning effort segmented control.
3. `apps/web/src/lib/slashCommandProvider.ts` plugs into the shared `useAutocomplete` contract. `/clear` resets the active chat view, `/fork` calls `chat.sessions.fork`, `/model` opens the model dropdown, and `/help` opens an inline command help strip.
4. `packages/web-api` exposes `chat.sessions.fork`, backed by `SessionStore.cloneSession`, so browser forks preserve copied messages and continue through the normal session APIs.
5. `apps/web/src/lib/useChatPromptHistory.ts` persists local prompt history and binds Up/Down arrows when the textarea is empty or the caret is at the start.
6. Browser verification on 2026-05-10 covered model persistence, `/` suggestions, `/help`, `/model`, prompt-history recall, and continued `@web` autocomplete accept behavior.

## Acceptance Criteria

The full milestone is complete when all of the following hold:

- `findRepoFiles` lives in `@strata/core`; `listModels` lives in `@strata/agent`. The TUI and the web both consume the same functions for file enumeration and model listing.
- `chat.files.list` and `chat.models.list` are exposed via tRPC and used by the web composer.
- A user can type `@` in the chat composer, see suggestions populated from the repo, navigate them with arrow keys, accept with Enter or Tab, and dismiss with Escape. The accepted value is `@path` (or `@path/` for directories), matching the TUI literal.
- A user can pick a model from the composer dropdown; the choice persists in `localStorage` and is included on the next `startChatRun` request.
- A user can type `/` to see slash-command suggestions and run them. At minimum `/clear` and `/help` work; `/model` opens the dropdown; `/fork` clones the active session.
- A user can recall earlier prompts with the up arrow when the textarea is empty and walk forward with the down arrow.
- `bun run check:workspaces` is green; `bun test` is green; `bun run biome:check` is clean.
- The TUI behavior is unchanged (regression-tested by running the existing TUI tests).

## Open Questions

- **Repo-file cache invalidation:** Should `findRepoFiles` watch the filesystem for changes, or is a 5s TTL plus a manual `chat.files.list({ refresh: true })` knob enough? The TUI hasn't needed watching; start with TTL only, revisit if users complain about stale completions after a `git pull`.
- **Cross-frontend preferences:** Should the chosen model eventually live in `~/.strata/preferences.json` so TUI and web stay in sync? Not yet — different surfaces may want different defaults (the TUI is often run as `strata` quickly; the web persists across browser sessions). Revisit if the user explicitly asks for a single preference store.
- **Slash command extensibility:** The TUI's slash list is partially driven by `.agents/skills/<name>/SKILL.md` registration (`/skill:<name>` commands). The web should defer that integration until skills/wiki commands are exposed via a stable agent-runtime registry; the initial web slash list can be a hard-coded constant.
- **Reasoning effort UI:** `ChatModelStatus` already exposes auth metadata but reasoning effort is currently per-run. The web dropdown should expose it next to the model id but only when the active model supports it. Detection lives in `@strata/agent`'s thinking-level handling and may need a small extension.
