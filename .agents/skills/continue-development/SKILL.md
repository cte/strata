---
name: continue-development
description: Resume Strata development from the current repository state. Use this skill when the user asks to continue, proceed, pick up the next milestone, keep building from where work left off, or otherwise wants Codex to understand the app, read the roadmap/status, identify the next concrete task, implement it, validate it, and update handoff docs.
---

# Continue Development

Use this workflow to continue Strata without asking the user to restate context that already lives in the repo.

## 1. Build Project Context

Read these files first, in order:

1. `AGENTS.md`
2. `docs/app-overview.md`
3. `docs/roadmap.md`
4. `docs/status.md`

Then read the detailed plan named by `docs/status.md` as the current or immediate milestone. For example, if status says the next milestone is web chat, read `docs/web-chat-plan.md`.

Do not skip code exploration. After reading docs, inspect the relevant package boundaries with `rg`, `find`, and focused file reads. Confirm where the source of truth lives before editing.

## 2. Understand The Current Handoff

Treat `docs/status.md` as the canonical handoff. In particular:

- Use `## Immediate Next Milestone` for the active milestone.
- Use `## Resume Here` for the first concrete implementation task.
- If those sections are missing, infer the next task from `docs/roadmap.md`, then add or update the missing handoff sections before ending the turn.

Before making substantial edits, form a short implementation plan:

- What app capability is being continued.
- Which packages/files are likely involved.
- What validation command will prove the change.

Do not ask the user "what next?" if `docs/status.md` already answers it.

## 3. Execute The Next Milestone

Implement the next useful vertical slice, not a broad speculative refactor.

Default sequence:

1. Read the relevant tests and public interfaces.
2. Make the smallest shared abstraction needed by the milestone.
3. Wire the caller surfaces through the shared abstraction.
4. Add or update tests around behavior, not implementation details.
5. Run the narrowest useful validation first, then broader checks when feasible.

For Strata specifically:

- Keep `runAgentLoopEvents()` in `packages/agent` as the source of truth for agent runs.
- Keep CLI, TUI, and web chat as interfaces over shared runtime packages.
- Keep connector logic in `packages/ingest`, not in React or route handlers.
- Use Bun commands, not npm.
- Preserve existing user changes in the worktree.

## 4. Maintain The Handoff

When the milestone materially changes, use `$maintain-documentation` before finishing. At minimum, keep `docs/status.md` and its `## Resume Here` handoff accurate after any completed milestone slice.

Final response should include:

- What was implemented.
- What validation was run.
- The next concrete task if work remains.
