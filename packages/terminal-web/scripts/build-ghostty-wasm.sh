#!/usr/bin/env bash
set -euo pipefail

# Strata-owned, repeatable Ghostty/libghostty WASM build.
#
# Produces packages/terminal-web/assets/ghostty-vt.wasm from a pinned Ghostty
# commit, a vendored API patch, and the pinned Zig toolchain. No particular
# external checkout layout is assumed: by default the pinned Ghostty commit is
# fetched into a gitignored cache under this package. Set GHOSTTY_SOURCE_DIR to
# reuse an existing Ghostty working tree instead.
#
# Bumping Ghostty: update GHOSTTY_COMMIT, refresh scripts/ghostty-wasm-api.patch
# against the new commit, and run this script. See scripts/README.md.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

# --- Pinned inputs (bump together; see scripts/README.md) --------------------
GHOSTTY_REMOTE=${GHOSTTY_REMOTE:-"https://github.com/ghostty-org/ghostty.git"}
GHOSTTY_COMMIT=${GHOSTTY_COMMIT:-"5714ed07a1012573261b7b7e3ed2add9c1504496"}
REQUIRED_ZIG=${REQUIRED_ZIG:-"0.15.2"}

PATCH_FILE="$SCRIPT_DIR/ghostty-wasm-api.patch"
CACHE_DIR=${GHOSTTY_BUILD_CACHE:-"$PACKAGE_DIR/.ghostty-build"}
DEFAULT_SOURCE_DIR="$CACHE_DIR/ghostty"
GHOSTTY_SOURCE_DIR=${GHOSTTY_SOURCE_DIR:-"$DEFAULT_SOURCE_DIR"}
OUT_FILE=${OUT_FILE:-"$PACKAGE_DIR/assets/ghostty-vt.wasm"}

# --- Zig toolchain (pinned via .tool-versions) -------------------------------
ZIG=${ZIG:-$(mise which zig 2>/dev/null || command -v zig || true)}
if [[ -z "$ZIG" ]]; then
  echo "error: zig not found. Install the pinned toolchain with: mise install" >&2
  exit 1
fi
ZIG_VERSION=$("$ZIG" version)
if [[ "$ZIG_VERSION" != "$REQUIRED_ZIG" ]]; then
  echo "error: zig $REQUIRED_ZIG required, found $ZIG_VERSION" >&2
  echo "       Strata pins Zig via .tool-versions; run: mise install" >&2
  echo "       (override with REQUIRED_ZIG=$ZIG_VERSION only if you know why)" >&2
  exit 1
fi

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "error: vendored Ghostty WASM patch missing at $PATCH_FILE" >&2
  exit 1
fi

# --- Resolve Ghostty source at the pinned commit -----------------------------
if [[ "$GHOSTTY_SOURCE_DIR" == "$DEFAULT_SOURCE_DIR" ]]; then
  # Strata-managed cache: shallow-fetch the pinned commit and check it out.
  mkdir -p "$CACHE_DIR"
  if ! git -C "$GHOSTTY_SOURCE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    echo "Initializing Ghostty source cache: $GHOSTTY_SOURCE_DIR"
    git init -q "$GHOSTTY_SOURCE_DIR"
    git -C "$GHOSTTY_SOURCE_DIR" remote add origin "$GHOSTTY_REMOTE"
  fi
  echo "Fetching Ghostty ${GHOSTTY_COMMIT:0:12} from $GHOSTTY_REMOTE"
  git -C "$GHOSTTY_SOURCE_DIR" fetch --depth 1 origin "$GHOSTTY_COMMIT"
  git -C "$GHOSTTY_SOURCE_DIR" -c advice.detachedHead=false checkout --force "$GHOSTTY_COMMIT"
  git -C "$GHOSTTY_SOURCE_DIR" submodule update --init --recursive --depth 1
else
  # Caller-provided checkout: verify the pin, do not mutate its ref.
  if ! git -C "$GHOSTTY_SOURCE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    echo "error: GHOSTTY_SOURCE_DIR is not a git checkout: $GHOSTTY_SOURCE_DIR" >&2
    exit 1
  fi
  HEAD_SHA=$(git -C "$GHOSTTY_SOURCE_DIR" rev-parse HEAD)
  if [[ "$HEAD_SHA" != "$GHOSTTY_COMMIT" ]]; then
    echo "warning: GHOSTTY_SOURCE_DIR is at $HEAD_SHA," >&2
    echo "         expected pinned $GHOSTTY_COMMIT — artifact may not match." >&2
  fi
  git -C "$GHOSTTY_SOURCE_DIR" submodule update --init --recursive
fi

mkdir -p "$(dirname "$OUT_FILE")"

# Reverse-apply on exit so the source tree returns to the pinned commit.
cleanup() {
  git -C "$GHOSTTY_SOURCE_DIR" apply -R "$PATCH_FILE" >/dev/null 2>&1 || true
  rm -f "$GHOSTTY_SOURCE_DIR/include/ghostty/vt/terminal.h"
  rm -f "$GHOSTTY_SOURCE_DIR/src/terminal/c/terminal.zig"
}
trap cleanup EXIT

echo "Building Ghostty WASM (commit ${GHOSTTY_COMMIT:0:12}, zig $ZIG_VERSION)"
git -C "$GHOSTTY_SOURCE_DIR" apply --check "$PATCH_FILE"
git -C "$GHOSTTY_SOURCE_DIR" apply "$PATCH_FILE"

(
  cd "$GHOSTTY_SOURCE_DIR"
  "$ZIG" build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
)

cp "$GHOSTTY_SOURCE_DIR/zig-out/bin/ghostty-vt.wasm" "$OUT_FILE"
chmod 0644 "$OUT_FILE"
echo "Wrote $OUT_FILE ($(wc -c < "$OUT_FILE") bytes)"
