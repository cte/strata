# Refactor Plan 07: Split Filesystem/Wiki Tools into Definitions and Implementations

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

The tool package has strong concepts, but some tool files are too broad:

- `packages/tools/src/fsTools.ts`
- `packages/tools/src/wikiTools.ts`

They combine prompt-facing tool definitions, JSON-schema inputs, argument parsing, policy checks, filesystem traversal, grep/find implementation, edit algorithms, diff rendering, write mutation recording, wiki path resolution, and wiki-specific operations.

That makes it harder to reuse core behavior outside the agent registry and harder to test the dangerous pieces in isolation.

## Target Shape

Tool definitions should be thin declarations. Tool behavior should live in focused implementation modules.

Suggested layout:

```text
packages/tools/src/fs/
  definitions.ts
  args.ts
  read.ts
  listFindGrep.ts
  write.ts
  edit.ts
  diff.ts
  pathSafety.ts

packages/tools/src/wiki/
  definitions.ts
  args.ts
  readSearchRetrieve.ts
  writePatch.ts
  indexLog.ts
  pathSafety.ts
```

Keep existing public exports from `packages/tools/src/fsTools.ts` and `wikiTools.ts` as compatibility barrels until imports are updated.

## Non-goals

- Do not weaken path safety.
- Do not change prompt-facing tool names.
- Do not change policy profile semantics.
- Do not replace exact edit semantics with fuzzy auto-application.

## Refactor Slices

### Slice 1: Extract argument parsing and shared helpers

1. Move `requiredString`, `optionalBoolean`, bounded integer parsing, and JSON coercion helpers into shared modules.
2. Keep error messages stable where tests assert them.
3. Use the same helpers from fs and wiki tools.

### Slice 2: Extract edit algorithm

1. Move exact text replacement, overlap detection, fuzzy diagnostics, and diff generation into `fs/edit.ts` and `fs/diff.ts`.
2. Keep `editTextFile()` as a public wrapper.
3. Add focused tests around overlapping edits, replaceAll, line endings, BOM, and diagnostics.

### Slice 3: Extract read/search traversal

1. Move list/find/grep traversal into `fs/listFindGrep.ts`.
2. Keep blocked path and raw-source behavior unchanged.
3. Preserve current result shapes.

### Slice 4: Extract wiki tools by capability

1. Move `wiki.readPage`, `wiki.search`, and `wiki.retrieve` implementation into read/search modules.
2. Move `wiki.writePage` and `wiki.patchPage` to write/patch modules.
3. Move `wiki.appendLog` and `wiki.updateIndex` to index/log modules.

### Slice 5: Thin definitions

1. Make `createFileSystemTools()` and `createWikiTools()` read as definitions plus handler references.
2. Keep prompt snippets/guidelines near the definitions.
3. Keep behavior in pure/testable functions.

## Acceptance Criteria

- Tool names, schemas, modes, max result chars, prompt snippets, and prompt guidelines remain compatible.
- Existing fs/wiki tool tests pass.
- Editing and wiki patch safety remain strict.
- The implementation for a tool can be understood without scrolling through unrelated tool definitions.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass.

## Risks

- Path policy duplication could weaken safety. Prefer one shared path-safety module, not copy-paste.
- Tool result shapes are model-facing; avoid accidental field renames.
- Fuzzy edit diagnostics are helpful but must never become silent fuzzy application.

## Documentation Notes

If prompt-facing tool behavior changes, update:

- [../agent-harness-plan.md](../agent-harness-plan.md)
- [../status.md](../status.md)
- [../../AGENTS.md](../../AGENTS.md)
