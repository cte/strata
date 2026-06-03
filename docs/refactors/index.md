# Refactor Plan Index

Status: planning index for ambitious maintainability work discovered during the thermo-nuclear code quality review.

These plans are intentionally structural. They are not feature milestones and should not interrupt the current product roadmap unless a planned feature would otherwise deepen the same debt. Use this index when choosing codebase-health work that preserves behavior while making Strata simpler to extend.

## Principles

- Preserve the documented architecture invariants in [AGENTS.md](../../AGENTS.md), [app-overview.md](../app-overview.md), [roadmap.md](../roadmap.md), and [status.md](../status.md).
- Prefer deleting categories of complexity over merely moving code around.
- Keep public package boundaries stable unless the plan explicitly calls out a boundary change.
- Make each extraction behavior-preserving first; introduce new capability only after the seam is clean.
- Add tests around the seam before or during extraction, not after a large rewrite.

## Plans

1. [Centralize runtime state and SQLite schema ownership](./01-centralize-runtime-state.md)
2. [Decompose the shared agent loop without creating a second loop](./02-agent-loop-decomposition.md)
3. [Decompose web chat and browser run state](./03-web-chat-decomposition.md)
4. [Rebuild raw-to-wiki as a source-adapter pipeline](./04-raw-to-wiki-pipeline.md)
5. [Extract proposal operations into a registry](./05-proposal-operation-registry.md)
6. [Modularize CLI commands and tRPC routers by domain](./06-cli-trpc-domain-modularization.md)
7. [Split filesystem/wiki tools into definitions and implementations](./07-tool-implementation-decomposition.md)
8. [Finish the web app feature-folder migration](./08-web-feature-folder-migration.md)
9. [Harden typed JSON boundaries](./09-typed-json-boundaries.md)
10. [Add architectural quality gates](./10-architecture-quality-gates.md)

## Suggested sequencing

The safest order is not strictly numeric:

1. **Quality gates first, in warning mode**: [10](./10-architecture-quality-gates.md) makes future regressions visible without forcing immediate cleanup.
2. **Typed boundaries next**: [9](./09-typed-json-boundaries.md) reduces risk before moving persistence, chat, routines, and tools.
3. **Runtime state centralization**: [1](./01-centralize-runtime-state.md) removes the most dangerous architectural split.
4. **High-churn surface decompositions**: [3](./03-web-chat-decomposition.md), [6](./06-cli-trpc-domain-modularization.md), [8](./08-web-feature-folder-migration.md), and [7](./07-tool-implementation-decomposition.md).
5. **Core behavior pipelines**: [2](./02-agent-loop-decomposition.md), [4](./04-raw-to-wiki-pipeline.md), and [5](./05-proposal-operation-registry.md), where test coverage and careful incremental extraction matter most.

## Global acceptance bar

A refactor slice is not done just because code moved. It should satisfy all of these:

- Behavior remains covered by existing tests or new focused tests.
- The old god file shrinks materially, or the extracted module owns a clear concept that future code can use directly.
- No new second implementation of a canonical flow is introduced.
- Documentation handoff stays accurate if a package boundary, runtime invariant, or roadmap-relevant sequencing changes.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass unless the failure is explicitly unrelated and documented.
