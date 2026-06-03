# Refactor Plan 10: Add Architectural Quality Gates

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

The repo has strong functional validation:

- `bun run check:workspaces`
- `bun test`
- `bun run biome:check`
- `bun run knip`

But architectural debt can grow while all of those pass. The clearest example is file-size and god-module accretion: multiple non-test files are already over 1000 LOC, and new features naturally land in the largest files because there is no automated friction.

Quality gates should make structural regression visible before it becomes normal.

## Target Shape

Add lightweight, local-first architecture checks that run in normal validation and fail only on clear regressions or configured hard limits.

Possible command:

```bash
bun run arch:check
```

Possible implementation:

```text
packages/core or scripts/
  architectureCheck.ts
  architecturePolicy.json
```

## Non-goals

- Do not block all existing large files immediately unless the team chooses to pay down the debt first.
- Do not replace human judgment.
- Do not make formatter-owned whitespace or generated files fail architecture checks.
- Do not introduce heavyweight static-analysis infrastructure if a simple script is enough.

## Proposed Gates

### File-size thresholds

- Warn at 900 LOC for non-test TypeScript/TSX files.
- Fail at 1200 LOC for new or non-allowlisted files.
- Track allowlisted legacy files with a target reduction note.

### Function/class-size thresholds

- Warn when a function/class exceeds 150 LOC.
- Fail for new functions/classes above a higher threshold unless allowlisted.

### Route-size threshold

- Warn when `apps/web/src/routes/*.tsx` exceeds 500 LOC after feature-folder migration.

### Package-boundary rules

- Block direct imports that violate known architecture layers.
- Example: web route components should not import server-only implementation modules.

### SQLite schema ownership rule

- Block `create table` / `alter table` in `.strata/state.sqlite` code outside core migrations/schema unless allowlisted.

### Loose JSON rule

- Report `z.any()`, `as unknown as`, and `as any` in non-test code, with an allowlist for unavoidable boundaries.

### Dead-code gate

- Keep `bun run knip` in the required validation set.
- Current observed issue to resolve: unused `lint-staged` devDependency in root `package.json`, unless intentionally kept for Husky/lint-staged integration.

## Refactor Slices

### Slice 1: Add measurement-only report

1. Create `scripts/architectureCheck.ts` or a small package command.
2. Print largest files, largest functions/classes, loose JSON sites, and ad-hoc schema sites.
3. Do not fail yet.

### Slice 2: Add policy file and allowlist

1. Add `architecturePolicy.json` with thresholds and legacy allowlist entries.
2. Require every allowlist entry to include a reason and target plan link.
3. Link allowlisted god files to the relevant plans in this directory.

### Slice 3: Turn clear regressions into failures

1. Fail if a non-allowlisted file exceeds the hard threshold.
2. Fail if new ad-hoc SQLite schema appears outside approved locations.
3. Fail if `knip` fails.

### Slice 4: Integrate into validation

1. Add `arch:check` to root `package.json`.
2. Decide whether `check` should include it immediately or after warning-only burn-in.
3. Document command in `AGENTS.md` once it is required.

## Acceptance Criteria

- The checker is fast enough for local use.
- Existing legacy debt is visible but not all immediately blocking unless intentionally configured.
- New structural regressions fail with actionable messages and plan links.
- `bun run check:workspaces`, `bun test`, `bun run knip`, and `bun run arch:check` pass once gates are enforced.

## Risks

- Gates that are too strict will be bypassed. Start with warnings and ratchet.
- LOC thresholds can encourage bad micro-splitting. Pair thresholds with code-review judgment.
- Regex-based checks may false-positive. Keep allowlists explicit and periodically reviewed.

## Documentation Notes

When `arch:check` becomes part of normal validation, update:

- [../../AGENTS.md](../../AGENTS.md)
- [../app-overview.md](../app-overview.md) if validation commands are listed there
- [../status.md](../status.md)
