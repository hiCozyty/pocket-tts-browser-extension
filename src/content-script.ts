/// <reference lib="dom" />

import { TTSEngine } from "./tts-engine";
import { EqualizerVisualizer } from "./equalizer";
import type {
  EngineStatus,
  RuntimeConfig,
  WasmWorkerVoiceInput,
} from "./protocol";
import { PRESET_VOICES, isPresetVoice } from "./protocol";

interface SelectionData {
  text: string;
  rect: DOMRect;
}

const HOST_ID = "pocket-tts-host";
const MIN_CHARS = 1;
const MAX_CHARS = 2000;
const HIDE_DELAY_MS = 250;

class FloatingUI {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private root: HTMLElement;
  private buttonContainer!: HTMLElement;
  private transcribeButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private equalizerCanvas!: HTMLCanvasElement;
  private statusBadge!: HTMLElement;
  private hintText!: HTMLElement;
  private downloadButton!: HTMLButtonElement;
  private progressRing!: HTMLElement;
  private progressRingFill: SVGCircleElement | null = null;

  private currentSelection: SelectionData | null = null;
  private hideTimeout: number | null = null;
  private equalizer: EqualizerVisualizer | null = null;
  private engine: TTSEngine | null = null;
  private config: RuntimeConfig | null = null;
  private isPlaying = false;
  private pcmChunks: Uint8Array[] = [];
  private isVisible = false;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    this.host.setAttribute("data-pocket-tts-host", "true");
    this.host.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    `;
    this.shadow = this.host.attachShadow({ mode: "closed" });
    this.injectStyles();
    this.root = this.buildUI();
    this.shadow.appendChild(this.root);
    document.documentElement.appendChild(this.host);
  }

  private injectStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        --ptts-bg: rgba(20, 20, 30, 0.96);
        --ptts-bg-hover: rgba(30, 30, 45, 0.98);
        --ptts-fg: #f5f5f7;
        --ptts-fg-dim: rgba(245, 245, 247, 0.65);
        --ptts-accent: #ec4899;
        --ptts-accent-2: #8b5cf6;
        --ptts-border: rgba(255, 255, 255, 0.08);
        --ptts-shadow: 0 8px 32px rgba(0, 0, 0, 0.36), 0 2px 6px rgba(0, 0, 0, 0.24);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }

      .ptts-root {
        position: fixed;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px 6px 6px;
        background: var(--ptts-bg);
        color: var(--ptts-fg);
        border: 1px solid var(--ptts-border);
        border-radius: 999px;
        box-shadow: var(--ptts-shadow);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        pointer-events: auto;
        transform-origin: 50% 100%;
        transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease;
        white-space: nowrap;
        user-select: none;
      }

      .ptts-root[data-state="hidden"] {
        opacity: 0;
        pointer-events: none;
        transform: translateY(6px) scale(0.96);
      }

      .ptts-root[data-state="visible"] {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      .ptts-icon-btn {
        appearance: none;
        border: none;
        background: linear-gradient(135deg, var(--ptts-accent-2), var(--ptts-accent));
        color: white;
        cursor: pointer;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        padding: 0;
        transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
      }

      .ptts-icon-btn:hover {
        transform: scale(1.06);
        filter: brightness(1.1);
      }

      .ptts-icon-btn:active {
        transform: scale(0.96);
      }

      .ptts-icon-btn[data-variant="stop"] {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
      }

      .ptts-icon-btn[data-variant="stop"]:hover {
        background: linear-gradient(135deg, #f87171, #ef4444);
      }

      .ptts-icon-btn[data-variant="download"] {
        background: rgba(255, 255, 255, 0.08);
        box-shadow: none;
        width: 28px;
        height: 28px;
      }

      .ptts-icon-btn[data-variant="download"]:hover {
        background: rgba(255, 255, 255, 0.15);
      }

      .ptts-icon-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .ptts-icon-btn svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .ptts-equalizer {
        width: 64px;
        height: 28px;
        margin: 0 -4px 0 0;
        display: block;
        opacity: 0;
        width: 0;
        transition: width 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 160ms ease, margin 200ms ease;
        overflow: hidden;
      }

      .ptts-root[data-mode="playing"] .ptts-equalizer {
        opacity: 1;
        width: 64px;
        margin: 0 4px 0 0;
      }

      .ptts-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--ptts-fg-dim);
        min-width: 0;
      }

      .ptts-status-text {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ptts-progress-ring {
        position: relative;
        width: 32px;
        height: 32px;
        display: none;
      }

      .ptts-root[data-mode="loading"] .ptts-progress-ring {
        display: block;
      }

      .ptts-progress-ring svg {
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }

      .ptts-progress-ring-track {
        fill: none;
        stroke: rgba(255, 255, 255, 0.1);
        stroke-width: 3;
      }

      .ptts-progress-ring-fill {
        fill: none;
        stroke: url(#ptts-progress-gradient);
        stroke-width: 3;
        stroke-linecap: round;
        transition: stroke-dashoffset 200ms ease;
      }

      .ptts-progress-ring-text {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 600;
        color: var(--ptts-fg);
      }

      .ptts-voice-select {
        appearance: none;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid var(--ptts-border);
        color: var(--ptts-fg);
        font-size: 11px;
        padding: 4px 22px 4px 8px;
        border-radius: 12px;
        cursor: pointer;
        font-family: inherit;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='white'><path d='M4 6l4 4 4-4'/></svg>");
        background-repeat: no-repeat;
        background-position: right 4px center;
        background-size: 10px;
        max-width: 90px;
        text-overflow: ellipsis;
      }

      .ptts-voice-select:focus {
        outline: none;
        border-color: var(--ptts-accent-2);
      }

      .ptts-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        background: rgba(20, 20, 30, 0.96);
        color: var(--ptts-fg);
        font-size: 11px;
        border-radius: 6px;
        border: 1px solid var(--ptts-border);
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 160ms ease;
      }

      .ptts-root:hover .ptts-tooltip {
        opacity: 1;
      }
    `;
    this.shadow.appendChild(style);
  }

  private buildUI(): HTMLElement {
    const root = document.createElement("div");
    root.className = "ptts-root";
    root.setAttribute("data-state", "hidden");
    root.setAttribute("data-mode", "idle");

    this.buttonContainer = document.createElement("div");
    this.buttonContainer.style.cssText = "display: flex; align-items: center; gap: 6px;";

    this.progressRing = document.createElement("div");
    this.progressRing.className = "ptts-progress-ring";
    this.progressRing.innerHTML = `
      <svg viewBox="0 0 32 32">
        <defs>
          <linearGradient id="ptts-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#8b5cf6"/>
            <stop offset="100%" stop-color="#ec4899"/>
          </linearGradient>
        </defs>
        <circle class="ptts-progress-ring-track" cx="16" cy="16" r="13"/>
        <circle class="ptts-progress-ring-fill" cx="16" cy="16" r="13"
                stroke-dasharray="81.68" stroke-dashoffset="81.68"/>
      </svg>
      <div class="ptts-progress-ring-text">0%</div>
    `;
    this.progressRingFill = this.progressRing.querySelector(".ptts-progress-ring-fill");
    this.buttonContainer.appendChild(this.progressRing);

    this.equalizerCanvas = document.createElement("canvas");
    this.equalizerCanvas.className = "ptts-equalizer";
    this.buttonContainer.appendChild(this.equalizerCanvas);

    this.transcribeButton = document.createElement("button");
    this.transcribeButton.className = "ptts-icon-btn";
    this.transcribeButton.setAttribute("data-variant", "transcribe");
    this.transcribeButton.setAttribute("aria-label", "Transcribe selected text");
    this.transcribeButton.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 2a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM4 5a4 4 0 0 1 8 0v4a4 4 0 0 1-8 0V5z"/>
        <path d="M2.5 8a.5.5 0 0 1 .5.5 5 5 0 0 0 10 0 .5.5 0 0 1 1 0 6 6 0 0 1-5 5.917V15h2a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1h2v-.583A6 6 0 0 1 2 8.5a.5.5 0 0 1 .5-.5z"/>
      </svg>
    `;
    this.buttonContainer.appendChild(this.transcribeButton);

    this.stopButton = document.createElement("button");
    this.stopButton.className = "ptts-icon-btn";
    this.stopButton.setAttribute("data-variant", "stop");
    this.stopButton.setAttribute("aria-label", "Stop playback");
    this.stopButton.style.display = "none";
    this.stopButton.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="10" height="10" rx="1.5"/>
      </svg>
    `;
    this.buttonContainer.appendChild(this.stopButton);

    this.statusBadge = document.createElement("div");
    this.statusBadge.className = "ptts-status";
    this.hintText = document.createElement("div");
    this.hintText.className = "ptts-status-text";
    this.hintText.textContent = "";
    this.statusBadge.appendChild(this.hintText);

    this.downloadButton = document.createElement("button");
    this.downloadButton.className = "ptts-icon-btn";
    this.downloadButton.setAttribute("data-variant", "download");
    this.downloadButton.setAttribute("aria-label", "Download as WAV");
    this.downloadButton.style.display = "none";
    this.downloadButton.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 11.5l4-4h-2.5V3h-3v4.5H4l4 4z"/>
        <path d="M2 13h12v1H2v-1z"/>
      </svg>
    `;
    this.buttonContainer.appendChild(this.downloadButton);

    const voiceSelect = document.createElement("select");
    voiceSelect.className = "ptts-voice-select";
    voiceSelect.setAttribute("aria-label", "Voice");
    for (const v of PRESET_VOICES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      voiceSelect.appendChild(opt);
    }
    this.buttonContainer.appendChild(voiceSelect);

    root.appendChild(this.buttonContainer);

    this.transcribeButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.handleTranscribeClick();
    });
    this.stopButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleStopClick();
    });
    this.downloadButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleDownloadClick();
    });
    voiceSelect.addEventListener("change", () => {
      void this.saveConfig({ voice: voiceSelect.value });
    });
    voiceSelect.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    voiceSelect.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    return root;
  }

  getRoot(): HTMLElement {
    return this.root;
  }

  show(selection: SelectionData): void {
    this.currentSelection = selection;
    if (this.hideTimeout != null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    const root = this.getRoot();
    if (!root) return;

    if (!this.isVisible) {
      root.setAttribute("data-state", "visible");
      this.isVisible = true;
    }

    this.positionAt(selection.rect);

    if (!this.isPlaying && this.engine?.getStatus().state !== "loading") {
      this.setMode("idle");
    }

    console.debug("[Pocket TTS] show()", {
      text: selection.text.slice(0, 60),
      rect: { top: selection.rect.top, left: selection.rect.left, width: selection.rect.width, height: selection.rect.height },
    });
  }

  hide(): void {
    if (this.isPlaying) return;
    if (this.hideTimeout != null) {
      clearTimeout(this.hideTimeout);
    }
    this.hideTimeout = window.setTimeout(() => {
      const root = this.getRoot();
      if (root) {
        root.setAttribute("data-state", "hidden");
      }
      this.isVisible = false;
      this.currentSelection = null;
      console.debug("[Pocket TTS] hide()");
    }, HIDE_DELAY_MS);
  }

  private positionAt(rect: DOMRect): void {
    const root = this.getRoot();
    if (!root) return;

    const popHeight = 50;
    const margin = 8;
    const halfW = (root.getBoundingClientRect().width / 2) || 120;

    let left = Math.max(halfW + 8, Math.min(window.innerWidth - halfW - 8, rect.left + rect.width / 2));
    let top = rect.top - popHeight - margin;

    if (top < 8) {
      top = rect.bottom + margin;
    }
    top = Math.max(8, Math.min(window.innerHeight - popHeight - 8, top));

    root.style.top = `${top}px`;
    root.style.left = `${left}px`;
    root.style.transform = "translateX(-50%)";
  }

  private setMode(mode: "idle" | "loading" | "playing" | "error" | "finished"): void {
    const root = this.getRoot();
    if (!root) return;
    root.setAttribute("data-mode", mode);

    if (mode === "idle") {
      this.transcribeButton.style.display = "flex";
      this.stopButton.style.display = "none";
      this.downloadButton.style.display = this.pcmChunks.length > 0 ? "flex" : "none";
      this.hintText.textContent = "";
    } else if (mode === "loading") {
      this.transcribeButton.style.display = "none";
      this.stopButton.style.display = "none";
      this.downloadButton.style.display = "none";
      this.hintText.textContent = "Loading...";
    } else if (mode === "playing") {
      this.transcribeButton.style.display = "none";
      this.stopButton.style.display = "flex";
      this.downloadButton.style.display = "none";
    } else if (mode === "finished") {
      this.transcribeButton.style.display = "flex";
      this.stopButton.style.display = "none";
      this.downloadButton.style.display = this.pcmChunks.length > 0 ? "flex" : "none";
      this.hintText.textContent = "";
    } else if (mode === "error") {
      this.transcribeButton.style.display = "flex";
      this.stopButton.style.display = "none";
      this.downloadButton.style.display = "none";
    }
  }

  private setProgress(percent: number): void {
    if (!this.progressRingFill) return;
    const circumference = 2 * Math.PI * 13;
    const offset = circumference - (percent / 100) * circumference;
    this.progressRingFill.style.strokeDashoffset = `${offset}`;
    const textEl = this.progressRing.querySelector(".ptts-progress-ring-text");
    if (textEl) {
      textEl.textContent = `${Math.round(percent)}%`;
    }
  }

  setEngine(engine: TTSEngine): void {
    this.engine = engine;
    engine.setOnChunk((samples) => {
      const pcm = float32ToPcm16(samples);
      this.pcmChunks.push(pcm);
    });
    engine.setOnDone(() => {
      this.isPlaying = false;
      this.setMode("finished");
      this.equalizer?.setVisible(false);
    });
    engine.setOnError((msg) => {
      this.hintText.textContent = msg.length > 30 ? msg.slice(0, 30) + "…" : msg;
      this.isPlaying = false;
      this.setMode("error");
      this.equalizer?.setVisible(false);
    });
  }

  isPlayingAudio(): boolean {
    return this.isPlaying;
  }

  attachAnalyser(analyser: AnalyserNode): void {
    if (this.equalizer) {
      this.equalizer.stop();
    }
    try {
      this.equalizer = new EqualizerVisualizer(this.equalizerCanvas, analyser);
      this.equalizer.resize();
    } catch (err) {
      console.error("Pocket TTS: failed to create equalizer", err);
    }
  }

  private async handleTranscribeClick(): Promise<void> {
    if (!this.engine || !this.config) return;
    if (!this.currentSelection) return;

    const text = this.currentSelection.text.trim();
    if (!text) return;

    if (!isPresetVoice(this.config.voice)) {
      this.hintText.textContent = "Bad voice";
      this.setMode("error");
      return;
    }

    this.pcmChunks = [];
    this.downloadButton.style.display = "none";
    this.setMode("loading");
    this.hintText.textContent = "Loading...";

    const statusHandler = (status: EngineStatus) => {
      this.setProgress(status.loadProgress);
      if (status.error) {
        this.hintText.textContent = status.error.length > 30
          ? status.error.slice(0, 30) + "…"
          : status.error;
      } else if (status.loadPhase === "loading-assets" && status.message) {
        this.hintText.textContent = "Downloading…";
      } else if (status.loadPhase === "compiling-model") {
        this.hintText.textContent = "Compiling…";
      } else if (status.loadPhase === "ready") {
        this.hintText.textContent = "";
      } else if (status.state === "buffering") {
        this.hintText.textContent = "Buffering…";
      } else if (status.state === "playing") {
        this.hintText.textContent = "";
      }
    };
    this.engine.init(this.config, statusHandler);

    this.isPlaying = true;
    this.setMode("playing");

    try {
      const voiceInput: WasmWorkerVoiceInput = {
        kind: "preset",
        voice: this.config.voice,
        hfRepo: this.config.hfRepo,
        hfToken: this.config.hfToken,
      };

      const generationPromise = this.engine.generate(text, voiceInput);

      const pollForAnalyser = (): void => {
        const analyser = this.engine?.getAnalyser();
        if (analyser) {
          this.attachAnalyser(analyser);
          this.equalizer?.setVisible(true);
        } else {
          setTimeout(pollForAnalyser, 30);
        }
      };
      pollForAnalyser();

      await generationPromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.hintText.textContent = msg.length > 30 ? msg.slice(0, 30) + "…" : msg;
      this.isPlaying = false;
      this.setMode("error");
      this.equalizer?.setVisible(false);
    }
  }

  private handleStopClick(): void {
    if (!this.engine) return;
    this.engine.stop();
    this.isPlaying = false;
    this.setMode("idle");
    this.equalizer?.setVisible(false);
  }

  private handleDownloadClick(): void {
    if (this.pcmChunks.length === 0) return;
    const sampleRate = this.engine?.getAnalyser()?.context.sampleRate ?? 24000;
    const wav = this.createWavBlob(this.pcmChunks, sampleRate);
    const url = URL.createObjectURL(wav);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pocket-tts-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private createWavBlob(chunks: Uint8Array[], sampleRate: number): Blob {
    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const wav = new Uint8Array(44 + totalLen);
    const view = new DataView(wav.buffer);
    const writeString = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) {
        view.setUint8(offset + i, s.charCodeAt(i));
      }
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + totalLen, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, totalLen, true);
    let offset = 44;
    for (const chunk of chunks) {
      wav.set(chunk, offset);
      offset += chunk.length;
    }
    return new Blob([wav], { type: "audio/wav" });
  }

  private async saveConfig(patch: Partial<RuntimeConfig>): Promise<void> {
    if (!this.config) return;
    this.config = { ...this.config, ...patch };
    try {
      const ext = (window as unknown as { pocketTtsExtension?: { saveConfig: (c: RuntimeConfig) => Promise<void> } }).pocketTtsExtension;
      if (ext) {
        await ext.saveConfig(this.config);
      }
    } catch (err) {
      console.warn("Pocket TTS: failed to persist config", err);
    }
  }

  setConfig(config: RuntimeConfig): void {
    this.config = config;
    const select = this.shadow.querySelector(".ptts-voice-select") as HTMLSelectElement | null;
    if (select && config.voice) {
      select.value = config.voice;
    }
  }
}

const STORAGE_KEY = "pocket_tts_config";

const DEFAULT_CONFIG: RuntimeConfig = {
  wasmBase: (typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("public/wasm")
    : "/public/wasm"),
  hfRepo: "kyutai/pocket-tts-without-voice-cloning",
  hfToken: "",
  voice: "alba",
  useCache: true,
};

const float32ToPcm16 = (samples: Float32Array): Uint8Array => {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, s));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(i * 2, int16, true);
  }
  return out;
};

const loadConfig = async (): Promise<RuntimeConfig> => {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as Partial<RuntimeConfig> | undefined;
    if (stored) {
      return { ...DEFAULT_CONFIG, ...stored };
    }
  } catch (err) {
    console.warn("Pocket TTS: failed to load config", err);
  }
  return DEFAULT_CONFIG;
};

const main = async (): Promise<void> => {
  if (document.getElementById(HOST_ID)) {
    return;
  }

  const ui = new FloatingUI();
  const engine = new TTSEngine();
  ui.setEngine(engine);

  const config = await loadConfig();
  ui.setConfig(config);

  console.log("[Pocket TTS] content script loaded", {
    host: !!document.getElementById(HOST_ID),
    config: { voice: config.voice, hfRepo: config.hfRepo, wasmBase: config.wasmBase },
  });

  const handleSelectionChange = (): void => {
    try {
      if (ui.isPlayingAudio()) {
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        ui.hide();
        return;
      }

      const text = sel.toString().trim();
      if (text.length < MIN_CHARS) {
        ui.hide();
        return;
      }
      if (text.length > MAX_CHARS) {
        ui.hide();
        return;
      }

      if (!isSelectionInPage(sel)) {
        ui.hide();
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        ui.hide();
        return;
      }

      console.debug("[Pocket TTS] selectionchange", {
        text: text.slice(0, 60),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      });

      ui.show({ text, rect });
    } catch (err) {
      console.error("[Pocket TTS] selection handler crashed", err);
    }
  };

  const isSelectionInPage = (sel: Selection): boolean => {
    if (sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement;
    if (!element) return false;
    return !element.closest(`#${HOST_ID}`);
  };

  document.addEventListener("mouseup", () => {
    setTimeout(handleSelectionChange, 10);
  }, true);

  document.addEventListener("keyup", (e) => {
    if (e.shiftKey || e.key === "Shift") {
      setTimeout(handleSelectionChange, 10);
    }
  }, true);

  document.addEventListener("selectionchange", () => {
    if (ui.isPlayingAudio()) return;
    setTimeout(handleSelectionChange, 10);
  });

  document.addEventListener("mousedown", (e) => {
    const target = e.target as Element;
    if (target && target.closest && target.closest(`#${HOST_ID}`)) {
      return;
    }
    if (!ui.isPlayingAudio()) {
      ui.hide();
    }
  }, true);

  window.addEventListener("scroll", () => {
    if (!ui.isPlayingAudio()) {
      ui.hide();
    }
  }, true);

  window.addEventListener("blur", () => {
    if (!ui.isPlayingAudio()) {
      ui.hide();
    }
  });

  // Expose for the settings page
  (window as unknown as { pocketTtsExtension?: unknown }).pocketTtsExtension = {
    saveConfig: async (cfg: RuntimeConfig) => {
      await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    },
    getConfig: async (): Promise<RuntimeConfig> => loadConfig(),
  };
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void main());
} else {
  void main();
}
