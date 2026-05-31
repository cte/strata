# Ghostty/libghostty WASM build

`assets/ghostty-vt.wasm` is the libghostty VT terminal compiled to
`wasm32-freestanding`. It is committed to the repo so day-to-day work needs no
WASM toolchain; this directory only matters when you rebuild it.

The build is intentionally self-contained — it does **not** assume any sibling
checkout (e.g. an external `ghostty-web`). Everything Strata needs is pinned
here.

## Pinned inputs

| Input | Value | Where it's pinned |
| --- | --- | --- |
| Ghostty remote | `https://github.com/ghostty-org/ghostty.git` | `GHOSTTY_REMOTE` in `build-ghostty-wasm.sh` |
| Ghostty commit | `5714ed07a1012573261b7b7e3ed2add9c1504496` | `GHOSTTY_COMMIT` in `build-ghostty-wasm.sh` |
| Zig | `0.15.2` | `.tool-versions` (asserted by the script via `REQUIRED_ZIG`) |
| API patch | `scripts/ghostty-wasm-api.patch` | vendored in this repo |

`ghostty-wasm-api.patch` adds the C/WASM VT API surface to upstream Ghostty
(the `lib-vt` build step, `src/terminal/c/*`, and the `include/ghostty/vt/*`
headers). It is vendored so the build no longer depends on any external patch
source.

## Rebuild

```bash
mise install                       # ensures the pinned Zig (0.15.2)
cd packages/terminal-web
bun run build:ghostty-wasm
```

By default the script shallow-fetches the pinned Ghostty commit into a
gitignored cache at `packages/terminal-web/.ghostty-build/ghostty`, applies the
vendored patch, runs `zig build lib-vt -Dtarget=wasm32-freestanding
-Doptimize=ReleaseSmall`, copies the artifact into `assets/`, and reverts the
patch. Network access is required the first time (Ghostty source, its
submodules, and Zig package dependencies).

### Reuse an existing Ghostty checkout

To build against a Ghostty working tree you already have (faster; no fetch):

```bash
GHOSTTY_SOURCE_DIR=/path/to/ghostty bun run build:ghostty-wasm
```

The script verifies the checkout is at the pinned commit and warns (but still
builds) if it differs. It applies and then reverse-applies the patch, leaving
the tree clean.

### Useful overrides

- `GHOSTTY_COMMIT` / `GHOSTTY_REMOTE` — build a different Ghostty revision.
- `REQUIRED_ZIG` — relax the Zig version assertion (only if you know why).
- `OUT_FILE` — write the artifact somewhere other than `assets/ghostty-vt.wasm`
  (handy for diffing a rebuild against the committed one).

## Bumping Ghostty

1. Pick the new commit; set `GHOSTTY_COMMIT`.
2. Refresh `scripts/ghostty-wasm-api.patch` so it applies cleanly to that
   commit (regenerate it from your patched Ghostty tree with `git diff`).
3. Rebuild, run `bun test` in this package, and commit the new
   `assets/ghostty-vt.wasm` alongside the patch/commit changes.
