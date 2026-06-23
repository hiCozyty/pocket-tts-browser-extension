# Pocket TTS Browser Extension

Highlight any text on a webpage and have it spoken aloud by a local, in-browser
neural text-to-speech model ([Pocket TTS](https://github.com/babybirdprd/pocket-tts)).

No servers. No API keys. No data leaves your machine.

## Features

- **Floating "Transcribe" button** appears next to your text selection
- **Streaming audio playback** with a real-time frequency equalizer
- **One-click Stop** button replaces the play button during playback
- **21 preset voices** (Alba, Anna, Azelma, Caro, Charles, Cosette, Eponine, Eve, Fantine, George, Jane, Javert, Jean, Marius, Mary, Michael, Paul, Peter, Vera, and more)
- **Voice cloning** — upload a 5–10 second WAV sample and the model will clone the speaker's voice
- **IndexedDB caching** of model weights and cloned voice states — first run downloads ~500MB, subsequent runs are instant
- **Shadow DOM isolation** — the floating UI doesn't affect page styles
- **Cross-browser** — Chrome (MV3) and Firefox (MV3-compatible manifest)

## Architecture

```
Content script (runs in every page)
  ├── Detects text selection, positions floating UI
  ├── AudioContext + AudioWorkletNode("pcm-processor")
  │   └── AnalyserNode → 12-bar canvas equalizer
  └── Spawns Web Worker:
      WASM TTS worker
        ├── Imports pocket_tts.js (wasm-bindgen)
        ├── Fetches model weights from HuggingFace (cached in IndexedDB)
        ├── Loads preset voice embedding or clones from uploaded WAV
        └── Streams Float32Array audio chunks back to content script
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Build the pocket-tts WASM binary

The extension needs the compiled WASM artifacts from pocket-tts.

```bash
# Clone the pocket-tts repo
git clone https://github.com/babybirdprd/pocket-tts.git ../pocket-tts

# Install Rust targets and wasm-pack
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Build the WASM module and copy it into the extension
POCKET_TTS_DIR=../pocket-tts ./scripts/fetch-wasm.sh
```

This will produce:
- `public/wasm/pocket_tts.js`
- `public/wasm/pocket_tts_bg.wasm`
- `public/wasm/pocket_tts.d.ts`

### 3. Build the extension

```bash
# Chrome (default)
npm run build

# Firefox (experimental - see note below)
BROWSER=firefox npm run build
```

The built extension is in `dist/`.

> **Firefox build note:** The `@crxjs/vite-plugin` v2 (beta) has known issues
> with Firefox MV3 manifests. The Chrome build works out of the box. For
> Firefox, you may need to manually adjust the generated `dist/manifest.json`:
> - Change `background.service_worker` to `background.scripts` (array)
> - Remove `"type": "module"` from the background section
> - Or use [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
>   to build/sign the extension after `npm run build`.

### 4. Load into your browser

**Chrome:**
1. Navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` directory

**Firefox:**
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on…"
3. Select `dist/manifest.json`

## Usage

1. Click the extension icon to open the settings popup
2. Pick a preset voice, or upload a WAV file for voice cloning
3. If using voice cloning, enter your HuggingFace token (required for gated model access)
4. Highlight any text on any webpage
5. Click the floating "Transcribe" button that appears next to your selection
6. The first run downloads model weights (~500MB) and caches them; subsequent runs are instant

## Configuration

| Setting | Default | Description |
|---|---|---|
| Voice | `alba` | One of 21 preset voices |
| Clone WAV | _(none)_ | Upload a 5–10s WAV to clone a custom voice |
| HF Token | _(empty)_ | HuggingFace access token (required for voice cloning, optional for preset voices) |

Model weights are fetched from `kyutai/pocket-tts` on HuggingFace.
Caching is always enabled and assets are stored in IndexedDB.

## Development

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Production build
npm run typecheck    # TypeScript check
```

## License

MIT
