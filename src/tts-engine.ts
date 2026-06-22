import type {
  EngineStatus,
  RuntimeConfig,
  WasmLoadStatus,
  WasmWorkerEvent,
  WasmWorkerRequest,
  WasmWorkerVoiceInput,
} from "./protocol";

type StatusListener = (status: EngineStatus) => void;
type ChunkListener = (samples: Float32Array) => void;
type DoneListener = () => void;
type ErrorListener = (message: string) => void;

const DEFAULT_WASM_START_THRESHOLD_SEC = 0.22;
const DEFAULT_WASM_RESUME_THRESHOLD_SEC = 0.34;

const SAMPLE_RATE = 24000;

const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.queue = [];
    this.queueOffset = 0;
    this.hasStarted = false;
    this.isBuffering = true;
    this.ended = false;
    this.firstAudioSent = false;
    this.tick = 0;
    this.underruns = 0;

    const startThreshold = options && options.processorOptions ? options.processorOptions.startThreshold : undefined;
    const resumeThreshold = options && options.processorOptions ? options.processorOptions.resumeThreshold : undefined;
    this.startThreshold = Number.isFinite(startThreshold) ? startThreshold : (24000 * 2.5);
    this.resumeThreshold = Number.isFinite(resumeThreshold) ? resumeThreshold : (24000 * 0.45);

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'samples' && msg.samples) {
        if (msg.samples instanceof Float32Array) {
          this.queue.push(msg.samples);
        } else if (msg.samples.buffer) {
          this.queue.push(new Float32Array(msg.samples.buffer));
        }
      } else if (msg.type === 'config') {
        if (Number.isFinite(msg.startThreshold)) {
          this.startThreshold = msg.startThreshold;
        }
        if (Number.isFinite(msg.resumeThreshold)) {
          this.resumeThreshold = msg.resumeThreshold;
        }
      } else if (msg.type === 'end') {
        this.ended = true;
      } else if (msg.type === 'reset') {
        this.queue = [];
        this.queueOffset = 0;
        this.hasStarted = false;
        this.isBuffering = true;
        this.ended = false;
        this.firstAudioSent = false;
        this.underruns = 0;
      }
    };
  }

  bufferedSamples() {
    let total = -this.queueOffset;
    for (let i = 0; i < this.queue.length; i++) {
      total += this.queue[i].length;
    }
    return Math.max(0, total);
  }

  fillSilence(channel, fromIdx = 0) {
    for (let i = fromIdx; i < channel.length; i++) {
      channel[i] = 0;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const channel = output[0];
    if (!channel) {
      return true;
    }

    const buffered = this.bufferedSamples();

    this.tick += 1;
    if (this.tick % 20 === 0) {
      this.port.postMessage({ type: 'buffer', length: buffered });
    }

    if (!this.hasStarted) {
      if (buffered < this.startThreshold) {
        this.fillSilence(channel);
        if (!this.isBuffering) {
          this.isBuffering = true;
          this.port.postMessage({ type: 'state', state: 'buffering' });
        }
        if (this.ended && buffered === 0) {
          return false;
        }
        return true;
      }
      this.hasStarted = true;
      this.isBuffering = false;
      this.port.postMessage({ type: 'state', state: 'playing' });
    }

    let idx = 0;
    while (idx < channel.length) {
      if (this.queue.length === 0) {
        this.fillSilence(channel, idx);
        if (!this.isBuffering) {
          this.isBuffering = true;
          this.underruns += 1;
          this.port.postMessage({ type: 'underrun', count: this.underruns });
          this.port.postMessage({ type: 'state', state: 'buffering' });
        }
        break;
      }

      const current = this.queue[0];
      const available = current.length - this.queueOffset;
      const toCopy = Math.min(available, channel.length - idx);
      channel.set(current.subarray(this.queueOffset, this.queueOffset + toCopy), idx);
      idx += toCopy;
      this.queueOffset += toCopy;

      if (this.queueOffset >= current.length) {
        this.queue.shift();
        this.queueOffset = 0;
      }
    }

    if (idx === channel.length && this.isBuffering && this.bufferedSamples() >= this.resumeThreshold) {
      this.isBuffering = false;
      this.port.postMessage({ type: 'state', state: 'playing' });
    }

    if (!this.firstAudioSent) {
      for (let i = 0; i < channel.length; i++) {
        if (Math.abs(channel[i]) > 1e-5) {
          this.firstAudioSent = true;
          this.port.postMessage({ type: 'first_audio' });
          break;
        }
      }
    }

    if (this.ended && this.bufferedSamples() === 0) {
      return false;
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
`;

const initialStatus: EngineStatus = {
  state: "idle",
  message: null,
  loadProgress: 0,
  loadPhase: "idle",
  loadSource: null,
  error: null,
  bufferSeconds: 0,
};

export class TTSEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private activeStreamRequestId: number | null = null;
  private statusListener: StatusListener | null = null;
  private chunkListener: ChunkListener | null = null;
  private doneListener: DoneListener | null = null;
  private errorListener: ErrorListener | null = null;
  private preparedVoice = "";
  private sampleRate = SAMPLE_RATE;
  private config: RuntimeConfig | null = null;
  private status: EngineStatus = { ...initialStatus };
  private ready = false;

  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;

  private readonly pending = new Map<
    number,
    { resolve: (payload?: { sampleRate?: number }) => void; reject: (err: Error) => void }
  >();

  init(config: RuntimeConfig, onStatus: StatusListener): void {
    this.config = config;
    this.statusListener = onStatus;
    if (!this.worker) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.worker = new Worker(new URL("./wasm-tts.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<WasmWorkerEvent>) => this.handleWorkerMessage(e);
    this.worker.onerror = (e) => {
      this.updateStatus({
        state: "error",
        message: e.message || "Worker error",
        error: e.message || "Worker error",
      });
    };
  }

  setOnChunk(listener: ChunkListener): void {
    this.chunkListener = listener;
  }

  setOnDone(listener: DoneListener): void {
    this.doneListener = listener;
  }

  setOnError(listener: ErrorListener): void {
    this.errorListener = listener;
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  isReady(): boolean {
    return this.ready;
  }

  private updateStatus(next: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...next };
    this.statusListener?.(this.status);
  }

  private postStatus(partial: Partial<WasmLoadStatus>): void {
    this.updateStatus({
      state: partial.ready
        ? "ready"
        : partial.phase === "error"
        ? "error"
        : this.status.state === "playing" || this.status.state === "buffering"
        ? this.status.state
        : "loading",
      message: partial.message ?? this.status.message,
      loadProgress: partial.progress ?? this.status.loadProgress,
      loadPhase: partial.phase ?? this.status.loadPhase,
      loadSource: partial.source ?? this.status.loadSource,
      error: partial.error ?? null,
    });
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (!this.config) {
      throw new Error("Engine not configured");
    }

    this.updateStatus({
      state: "loading",
      message: "Initializing engine...",
      error: null,
    });

    try {
      const payload = await this.sendRpc({
        kind: "init",
        wasmBase: this.config.wasmBase,
        hfRepo: this.config.hfRepo,
        hfToken: this.config.hfToken,
        useCache: this.config.useCache,
      });
      if (typeof payload?.sampleRate === "number" && payload.sampleRate > 0) {
        this.sampleRate = Math.round(payload.sampleRate);
      }
      this.ready = true;
      this.preparedVoice = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: "error", message, error: message });
      throw err;
    }
  }

  async prepareVoice(voice: WasmWorkerVoiceInput): Promise<void> {
    await this.ensureReady();
    const sig = this.voiceSignature(voice);
    if (sig === this.preparedVoice) return;
    await this.sendRpc({ kind: "prepare_voice", voice });
    this.preparedVoice = sig;
  }

  private voiceSignature(voice: WasmWorkerVoiceInput): string {
    if (voice.kind === "preset") return `preset:${voice.voice}:${voice.hfRepo}`;
    if (voice.kind === "wav") return `wav:${voice.wavBytes.byteLength}`;
    return `emb:${voice.embeddingBytes.byteLength}`;
  }

  async ensureAudio(): Promise<{ sampleRate: number }> {
    if (typeof AudioContext === "undefined") {
      throw new Error("Web Audio API not available");
    }

    if (this.audioCtx && this.workletNode && this.analyser) {
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }
      return { sampleRate: this.sampleRate };
    }

    const desiredRate = this.sampleRate;

    if (this.audioCtx && Math.round(this.audioCtx.sampleRate) !== desiredRate) {
      await this.audioCtx.close();
      this.audioCtx = null;
      this.workletNode = null;
      this.analyser = null;
      this.gainNode = null;
    }

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate: desiredRate });
      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        await this.audioCtx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    if (!this.workletNode) {
      this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-processor", {
        processorOptions: {
          startThreshold: Math.round(desiredRate * DEFAULT_WASM_START_THRESHOLD_SEC),
          resumeThreshold: Math.round(desiredRate * DEFAULT_WASM_RESUME_THRESHOLD_SEC),
        },
      });

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.7;

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      this.workletNode.connect(this.analyser);
      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.workletNode.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; length?: number; state?: string; count?: number };
        if (data.type === "buffer" && typeof data.length === "number") {
          this.updateStatus({
            bufferSeconds: data.length / this.sampleRate,
          });
        } else if (data.type === "state") {
          if (data.state === "buffering") {
            this.updateStatus({ state: "buffering" });
          } else if (data.state === "playing") {
            this.updateStatus({ state: "playing" });
          }
        } else if (data.type === "underrun") {
          // no-op
        }
      };
    }

    return { sampleRate: desiredRate };
  }

  resetWorklet(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "reset" });
    }
  }

  disconnectWorklet(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
  }

  feedSamples(samples: Float32Array): void {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: "samples", samples }, [samples.buffer]);
  }

  endStream(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "end" });
    }
  }

  async generate(text: string, voice: WasmWorkerVoiceInput): Promise<void> {
    await this.prepareVoice(voice);
    await this.ensureAudio();
    this.resetWorklet();
    this.updateStatus({ state: "buffering", message: null, error: null });
    await this.sendRpc({ kind: "start_stream", text: text.trim() });
  }

  stop(): void {
    if (this.worker) {
      const stopMessage: WasmWorkerRequest = { kind: "stop" };
      this.worker.postMessage(stopMessage);
    }
    if (this.activeStreamRequestId != null) {
      const pending = this.pending.get(this.activeStreamRequestId);
      if (pending) {
        pending.reject(new Error("abort"));
        this.pending.delete(this.activeStreamRequestId);
      }
      this.activeStreamRequestId = null;
    }
    this.endStream();
    this.updateStatus({ state: "idle", message: null });
  }

  dispose(): void {
    this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.workletNode = null;
    this.analyser = null;
    this.gainNode = null;
    this.ready = false;
  }

  private sendRpc(
    message:
      | Omit<Extract<WasmWorkerRequest, { kind: "init" }>, "requestId">
      | Omit<Extract<WasmWorkerRequest, { kind: "prepare_voice" }>, "requestId">
      | Omit<Extract<WasmWorkerRequest, { kind: "start_stream" }>, "requestId">,
  ): Promise<{ sampleRate?: number } | undefined> {
    if (!this.worker) {
      return Promise.reject(new Error("Worker not initialized"));
    }
    const requestId = this.nextRequestId++;
    const requestWithId = { ...message, requestId } as WasmWorkerRequest;

    if (message.kind === "start_stream") {
      this.activeStreamRequestId = requestId;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker!.postMessage(requestWithId);
    });
  }

  private handleWorkerMessage(event: MessageEvent<WasmWorkerEvent>): void {
    const data = event.data;

    if (data.kind === "status") {
      this.postStatus(data.status);
      return;
    }

    if (data.kind === "stream_first_chunk") {
      this.updateStatus({ state: "buffering" });
      return;
    }

    if (data.kind === "stream_chunk") {
      this.chunkListener?.(data.chunk);
      this.feedSamples(data.chunk);
      return;
    }

    if (data.kind === "stream_done") {
      this.endStream();
      this.updateStatus({ state: "finished" });
      this.doneListener?.();
      return;
    }

    if (data.kind === "stream_error") {
      this.errorListener?.(data.error);
      return;
    }

    if (data.kind === "rpc_ok") {
      const pending = this.pending.get(data.requestId);
      if (pending) {
        pending.resolve(data.payload);
        this.pending.delete(data.requestId);
      }
      if (this.activeStreamRequestId === data.requestId) {
        this.activeStreamRequestId = null;
      }
      return;
    }

    if (data.kind === "rpc_err") {
      const pending = this.pending.get(data.requestId);
      if (pending) {
        const isAbort = data.error === "abort" || data.error.toLowerCase().includes("abort");
        if (!isAbort) {
          this.errorListener?.(data.error);
        }
        pending.reject(new Error(data.error));
        this.pending.delete(data.requestId);
      }
      if (this.activeStreamRequestId === data.requestId) {
        this.activeStreamRequestId = null;
      }
    }
  }
}
