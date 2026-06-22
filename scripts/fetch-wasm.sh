#!/usr/bin/env bash
set -euo pipefail

# Builds the Pocket TTS WASM module and copies it into this extension's
# public/wasm/ directory so it can be loaded via chrome.runtime.getURL.
#
# Prerequisites:
#   1. Clone pocket-tts:
#        git clone https://github.com/babybirdprd/pocket-tts.git
#   2. Install wasm32 target:
#        rustup target add wasm32-unknown-unknown
#   3. Install wasm-bindgen-cli:
#        cargo install wasm-bindgen-cli
#
# Usage:
#   POCKET_TTS_DIR=../pocket-tts ./scripts/fetch-wasm.sh
#
# Output:
#   public/wasm/pocket_tts.js
#   public/wasm/pocket_tts_bg.wasm
#   public/wasm/pocket_tts.d.ts (optional)

POCKET_TTS_DIR="${POCKET_TTS_DIR:-../pocket-tts}"
OUT_DIR="${OUT_DIR:-public/wasm}"

if [ ! -d "$POCKET_TTS_DIR" ]; then
  echo "Error: pocket-tts directory not found at: $POCKET_TTS_DIR" >&2
  echo "Set POCKET_TTS_DIR to the path of your pocket-tts checkout." >&2
  exit 1
fi

echo "Building pocket-tts WASM..."
(cd "$POCKET_TTS_DIR" && \
  cargo build -p pocket-tts --release \
    --target wasm32-unknown-unknown --features wasm)

WASM_PATH="$POCKET_TTS_DIR/target/wasm32-unknown-unknown/release/pocket_tts.wasm"

if [ ! -f "$WASM_PATH" ]; then
  echo "Error: WASM build did not produce $WASM_PATH" >&2
  exit 1
fi

echo "Generating wasm-bindgen bindings..."
(cd "$POCKET_TTS_DIR" && \
  wasm-bindgen --target web --out-dir "$POCKET_TTS_DIR/target/wasm-bindgen" "$WASM_PATH")

mkdir -p "$OUT_DIR"
cp "$POCKET_TTS_DIR/target/wasm-bindgen/pocket_tts.js" "$OUT_DIR/"
cp "$POCKET_TTS_DIR/target/wasm-bindgen/pocket_tts_bg.wasm" "$OUT_DIR/"

if [ -f "$POCKET_TTS_DIR/target/wasm-bindgen/pocket_tts.d.ts" ]; then
  cp "$POCKET_TTS_DIR/target/wasm-bindgen/pocket_tts.d.ts" "$OUT_DIR/"
fi

echo "Done. WASM artifacts copied to $OUT_DIR/"
ls -la "$OUT_DIR/"
