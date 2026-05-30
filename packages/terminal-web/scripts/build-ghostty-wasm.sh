#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(cd "$PACKAGE_DIR/../.." && pwd)
GHOSTTY_WEB_DIR=${GHOSTTY_WEB_DIR:-"$REPO_ROOT/../ghostty-web"}
GHOSTTY_SOURCE_DIR=${GHOSTTY_SOURCE_DIR:-"$GHOSTTY_WEB_DIR/ghostty"}
GHOSTTY_WASM_PATCH=${GHOSTTY_WASM_PATCH:-"$GHOSTTY_WEB_DIR/patches/ghostty-wasm-api.patch"}
OUT_FILE="$PACKAGE_DIR/assets/ghostty-vt.wasm"

ZIG=${ZIG:-$(mise which zig 2>/dev/null || command -v zig || true)}

if [[ -z "$ZIG" ]]; then
  echo "zig is required to build the Ghostty WASM artifact. Run: mise install zig" >&2
  exit 1
fi

if [[ ! -d "$GHOSTTY_WEB_DIR/.git" ]]; then
  echo "ghostty-web reference checkout not found at $GHOSTTY_WEB_DIR" >&2
  exit 1
fi

if [[ ! -d "$GHOSTTY_SOURCE_DIR/.git" ]]; then
  git -C "$GHOSTTY_WEB_DIR" submodule update --init --recursive ghostty
fi

if [[ ! -f "$GHOSTTY_WASM_PATCH" ]]; then
  echo "Ghostty WASM API patch not found at $GHOSTTY_WASM_PATCH" >&2
  exit 1
fi

mkdir -p "$PACKAGE_DIR/assets"

cleanup() {
  git -C "$GHOSTTY_SOURCE_DIR" apply -R "$GHOSTTY_WASM_PATCH" >/dev/null 2>&1 || true
  rm -f "$GHOSTTY_SOURCE_DIR/include/ghostty/vt/terminal.h"
  rm -f "$GHOSTTY_SOURCE_DIR/src/terminal/c/terminal.zig"
}
trap cleanup EXIT

echo "Building Ghostty WASM with zig $("$ZIG" version)"
git -C "$GHOSTTY_SOURCE_DIR" apply --check "$GHOSTTY_WASM_PATCH"
git -C "$GHOSTTY_SOURCE_DIR" apply "$GHOSTTY_WASM_PATCH"

(
  cd "$GHOSTTY_SOURCE_DIR"
  "$ZIG" build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
)

cp "$GHOSTTY_SOURCE_DIR/zig-out/bin/ghostty-vt.wasm" "$OUT_FILE"
chmod 0644 "$OUT_FILE"
echo "Wrote $OUT_FILE"
