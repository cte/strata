# Domain Docs

This repo uses a single-context domain-doc layout.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- `docs/adr/` for architectural decisions that touch the area you're about to work in.

If any of these files do not exist, proceed silently. Do not flag their absence or suggest creating them upfront. The producer skill creates them lazily when terms or decisions actually get resolved.

## File structure

```text
/
├── CONTEXT.md
├── docs/adr/
└── packages/
```

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, either reconsider the term or note the gap for the producer skill.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
