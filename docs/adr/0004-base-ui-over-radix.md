---
status: accepted
date: 2026-06-03
---

# Web UI primitives standardize on Base UI, not Radix

## Context

The `apps/web` control plane uses shadcn-style component wrappers under
`apps/web/src/components/ui/`. These were generated from the **classic** shadcn
registry, which builds on **Radix UI** primitives (`@radix-ui/react-*`) plus
`cmdk` for the command palette. At the same time `@base-ui/react` was already a
dependency and one component (`tabs.tsx`) had already been migrated to Base UI,
so the UI layer was split across two primitive libraries with two different
prop conventions.

The intended direction is a single primitive library. shadcn now ships a Base UI
registry variant (e.g. `https://ui.shadcn.com/docs/components/base/command`), and
Base UI 1.4.1 covers every primitive the app uses — including `autocomplete` /
`combobox`, which replace `cmdk` for the command palette. Keeping two libraries
means every contributor (human or agent) has to know which convention a given
component follows, and copy-pasting from the wrong docs page silently breaks
styling (this happened with the model picker: a Base-UI `data-[slot=...]` selector
was pasted onto a cmdk/Radix Command and did nothing).

## Decision

Standardize all `apps/web` UI primitives on **Base UI** (`@base-ui/react`) and
remove Radix (`@radix-ui/*`) and `cmdk`.

Conventions:

- **No `asChild`.** Base UI composes via the `render` prop
  (`<Dialog.Trigger render={<Button />} />`) and `useRender` for custom
  wrappers. `@radix-ui/react-slot` is removed; `button.tsx`/`sidebar.tsx` use
  `render`/`useRender` instead of `Slot`.
- **State styling uses Base UI data attributes** (`data-open`, `data-checked`,
  `data-unchecked`, `data-selected`, `data-highlighted`, …), not Radix's
  `data-[state=open]` / `cmdk-*` attribute selectors.
- **Open/close state** uses Base UI signatures: `onOpenChange(open, details)`
  for popups, `onCheckedChange(checked, details)` for switches. The extra
  `details` argument is ignored by existing `(open) => …` callbacks.
- **Command palette** is rebuilt on Base UI `Autocomplete`/`Combobox`; `cmdk` is
  removed. The `ui/command.tsx` API surface is preserved where practical so
  `ai-elements/model-selector.tsx` and other consumers change minimally.
- New components are added from the **shadcn Base UI registry**, never the
  classic Radix registry.

## Consequences

- ~12 `ui/` wrappers are rewritten against Base UI; `~30` `asChild` call sites
  across routes and `ai-elements` become `render`.
- `@radix-ui/*` and `cmdk` are dropped from `apps/web/package.json`.
- `AGENTS.md` Web UI conventions and the UI-related skills are updated to state
  the Base UI preference and the `render`-over-`asChild` rule.
- Component stories (`*.stories.tsx`) are the visual-regression surface; each
  migrated primitive is verified against its story.

## Status: implemented

All `apps/web/src/components/ui/` primitives now build on `@base-ui/react`:
separator, switch, progress, collapsible, button (`useRender`), popover, tooltip,
hover-card (→ `PreviewCard`), scroll-area, dialog, sheet, dropdown-menu
(→ `Menu`), select (→ `Select`), sidebar (`Slot` → a local `renderSlot`/`useRender`
helper), and command (→ `Combobox`). `command.tsx` supports both a data-driven
mode (grouped/flat `items` + `CommandList` render-fn + `CommandCollection`,
used by the model picker) and a children-driven, externally-filtered mode
(`filter={null}` + controlled `inputValue`, used by the ⌘K session palette).
`@radix-ui/*` and `cmdk` are removed from `apps/web/package.json`; `bun install`,
`knip`, `biome`, `tsgo` (0 errors), the web Vite build, and the web test suite
all pass.

### Migration gotcha: `render` must target the real child, not a wrapper

Radix `asChild` merged the trigger's props/ref onto the single child element.
Base UI's `render` prop does the same, so translate `<Trigger asChild>{child}`
to `<Trigger render={child} />` — pass the **existing** element. Wrapping the
child in a fresh layout element (e.g. `render={<span>{children}</span>}`)
reintroduces a DOM node the original tree never had; an unconstrained inline
wrapper around a flex/`min-w-0`/`truncate` subtree expands to its content width
and defeats truncation. This caused a chat-tab title overflow (the hover-card
trigger in `ChatTabPromptHoverCard`) and was fixed by rendering the trigger
onto the tab's own `<button>`.

### Migration gotcha: stacking `z-index` belongs on the `Positioner`

Base UI positions popups by putting a `transform` on the `Positioner`, which
establishes a new stacking context. A `z-50` on the inner `Popup` is therefore
scoped to that context and does not compete at the body level, so it loses to
the app shell's `.root { z-index: 1; isolation: isolate }` and the popup paints
**behind** the page. The popup still opens, but `elementFromPoint` over its
content returns the page underneath, so it is unclickable and clicks fall
through — which presented as "popovers and dropdown menus no longer work."
Fix: set `className="z-50"` on the `Positioner` (the top-level portaled element)
for `dropdown-menu`, `popover`, `tooltip`, and `hover-card`. (`select` already
did this, which is why it kept working.)

### Migration gotcha: register Base UI `data-*` state as Tailwind variants

Base UI exposes component state through **bare** data attributes (`data-open`,
`data-closed`, `data-highlighted`, `data-checked`, `data-disabled`,
`data-panel-open`, `data-starting-style`/`data-ending-style`), whereas Radix
used `data-[state=open]`. Tailwind v4 does **not** ship these bare attributes as
built-in variants, and the migrated `components/ui/*` use the bare form
everywhere (`data-open:animate-in`, `data-highlighted:bg-surface-2`, …). Without
registration those utilities **silently compile to nothing**, which broke two
things at once: menu/select/list item highlight styling, and the open/close
animations. Fix: register each as an `@custom-variant` in `globals.css` (e.g.
`@custom-variant data-open (&[data-open], &[data-popup-open])`). Note that
adding/changing an `@custom-variant` requires a dev-server restart — Tailwind
caches its variant set, so HMR alone leaves the new utilities ungenerated.

### Migration gotcha: closing popups need `fill-mode-forwards` or they flash

With the animation variants registered, dialogs/menus/popovers still flashed on
close: the `exit` keyframe faded opacity to 0, but because `tw-animate`'s
`animate-out` uses `animation-fill-mode: none`, the element reverted to its base
opacity (1) for the few frames between the animation ending and Base UI
unmounting it — a visible flash/blink. Fix: add `data-closed:fill-mode-forwards`
(and `data-closed:duration-*` where needed) to every closing surface
(`dialog`/`sheet` backdrop + popup, `dropdown-menu`, `popover`, `tooltip`,
`hover-card`, `select`) so the popup holds its faded-out end state until unmount.
Verify by sampling the backdrop's computed `opacity` per frame across a close: it
should decrease monotonically to 0 and stay there, never snapping back to 1.

## Audit against the canonical Base UI registry (2026-06-08)

Every migrated `ui/` primitive was diffed against the canonical shadcn Base UI
registry source (`shadcn-ui/ui` → `apps/v4/registry/bases/base/ui/<name>.tsx`).
Key context: the current registry has moved to a new `cn-*` design-system style
(per-component CSS classes) that is line-for-line incompatible with our older
`new-york` Tailwind-utility components, so only **structure, primitive parts,
props, `render` usage, and state attributes** were treated as in scope — not the
class tokens. Results:

- **Structurally correct, no change needed:** `button`, `collapsible`, `switch`,
  `separator`, `tabs`, `progress` (canonical adds optional `ProgressLabel`/
  `ProgressValue` sub-parts we simply don't expose), `scroll-area` (we wrap
  children in the valid Base UI `ScrollArea.Content` part, which the registry
  omits but Base UI's own docs include).
- **`isolate` added to every popup positioner/backdrop** to match the canonical,
  hardening the stacking-context fix (`dialog`/`sheet` backdrop, `popover`,
  `tooltip`, `hover-card`, `dropdown-menu` ×2, `select`).
- **`select`:** wrapped item children in `SelectPrimitive.List` (keyboard/scroll
  management) to match the canonical structure.
- **`dropdown-menu` submenu:** the canonical `DropdownMenuSubContent` reuses
  `DropdownMenuContent` with `side="right"`/`align="start"`/`alignOffset={-3}`;
  ours hand-rolls the positioner, so we added those flyout defaults (submenus are
  not currently used in the app, but the part is now correct).
- **Intentional divergences (kept):**
  - `command` is built on Base UI `Combobox`, whereas the canonical registry
    **still uses `cmdk`** (Base UI has no command primitive). This repo chose
    "Base-UI-pure" and removed `cmdk`, so our Combobox-based `command` is a
    deliberate divergence, not a regression — verified working (open, filter,
    select).
  - Animations: the canonical uses Base UI's idiomatic
    `data-starting-style`/`data-ending-style` **CSS transitions** (inherently
    flash-free), while we use `tw-animate` `animate-in`/`animate-out` keyframes
    plus `data-closed:fill-mode-forwards`. Our approach is verified flash-free;
    moving to the transition model is the cleaner long-term direction but was not
    worth the regression risk once the flash was fixed.
  - `data-slot="..."` attributes (a newer registry selector-hook convention) are
    not added; our older components never had them and nothing depends on them.
- **`components.json`** has no `base` field (the schema does not define one), and
  the registry's `cn-*` components are incompatible with our style, so
  `shadcn add` is not used to manage these — they are a hand-maintained Base UI
  port.
