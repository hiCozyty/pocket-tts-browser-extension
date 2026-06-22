import type { WasmWorkerEvent, WasmWorkerRequest } from "./protocol";

const log = (() => {
  const pre = document.getElementById("log") as HTMLPreElement;
  return (text: string, cls?: "ok" | "err") => {
    const ts = new Date().toISOString().slice(11, 23);
    const span = cls ? `<span class="${cls}">[${ts}] ${text}</span>\n` : `[${ts}] ${text}\n`;
    pre.innerHTML += span;
    pre.scrollTop = pre.scrollHeight;
    if (cls === "err") console.error(text);
    else   };
})();

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const voiceEl = $<HTMLSelectElement>("voice");
const textEl = $<HTMLInputElement>("text");
const hfRepoEl = $<HTMLInputElement>("hfRepo");
const hfTokenEl = $<HTMLInputElement>("hfToken");
const useCacheEl = $<HTMLInputElement>("useCache");
const initBtn = $<HTMLButtonElement>("initBtn");
const voiceBtn = $<HTMLButtonElement>("voiceBtn");
const playBtn = $<HTMLButtonElement>("playBtn");
const stopBtn = $<HTMLButtonElement>("stopBtn");

const WORKER_URL = new URL("./wasm-tts.worker.ts", import.meta.url);
log(`worker URL = ${WORKER_URL.href}`);

const WASM_BASE = chrome.runtime
  ? chrome.runtime.getURL("public/wasm")
  : new URL("./public/wasm", location.href).href;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

const rpc = (msg: Record<string, unknown>): Promise<void> => {
  if (!worker) return Promise.reject(new Error("worker not ready"));
  return new Promise<void>((resolve, reject) => {
    const requestId = nextRequestId++;
    pending.set(requestId, { resolve, reject });
    worker!.postMessage({ ...msg, requestId } as unknown as WasmWorkerRequest);
  });
};

const setupWorker = (): void => {
  log("spawning worker...");
  const w = new Worker(WORKER_URL, { type: "module" });

  w.onmessage = (e: MessageEvent<WasmWorkerEvent>) => {
    const data = e.data;
    if (data.kind === "status") {
      const s = data.status;
      log(`status phase=${s.phase} progress=${s.progress} ready=${s.ready} ${s.message ?? ""}`);
    } else if (data.kind === "rpc_ok") {
      log(`rpc_ok #${data.requestId}`, "ok");
      const p = pending.get(data.requestId);
      p?.resolve();
      pending.delete(data.requestId);
    } else if (data.kind === "rpc_err") {
      log(`rpc_err #${data.requestId}: ${data.error}`, "err");
      const p = pending.get(data.requestId);
      p?.reject(new Error(data.error));
      pending.delete(data.requestId);
    } else if (data.kind === "stream_first_chunk") {
      log("stream_first_chunk");
    } else if (data.kind === "stream_chunk") {
      log(`stream_chunk samples=${data.chunk.length}`);
    } else if (data.kind === "stream_done") {
      log("stream_done", "ok");
    } else if (data.kind === "stream_error") {
      log(`stream_error: ${data.error}`, "err");
    }
  };

  w.onerror = (e) => {
    log(`worker error: ${e.message}`, "err");
  };

  worker = w;
};

const init = async () => {
  try {
    initBtn.disabled = true;
    if (!worker) setupWorker();
    log(`init: wasmBase=${WASM_BASE}`);
    await rpc({
      kind: "init",
      wasmBase: WASM_BASE,
      hfRepo: hfRepoEl.value,
      hfToken: hfTokenEl.value,
      useCache: useCacheEl.checked,
    });
    log("init complete", "ok");
    voiceBtn.disabled = false;
  } catch (err) {
    log(`init failed: ${err instanceof Error ? err.message : String(err)}`, "err");
    initBtn.disabled = false;
  }
};

const prepareVoice = async () => {
  try {
    voiceBtn.disabled = true;
    log(`prepare_voice: ${voiceEl.value}`);
    await rpc({
      kind: "prepare_voice",
      voice: { kind: "preset", voice: voiceEl.value, hfRepo: hfRepoEl.value, hfToken: hfTokenEl.value },
    });
    log("voice ready", "ok");
    playBtn.disabled = false;
  } catch (err) {
    log(`prepare_voice failed: ${err instanceof Error ? err.message : String(err)}`, "err");
    voiceBtn.disabled = false;
  }
};

const startStream = async () => {
  try {
    playBtn.disabled = true;
    log(`start_stream: ${textEl.value}`);
    await rpc({ kind: "start_stream", text: textEl.value });
    log("stream finished", "ok");
    playBtn.disabled = false;
  } catch (err) {
    log(`start_stream failed: ${err instanceof Error ? err.message : String(err)}`, "err");
    playBtn.disabled = false;
  }
};

const stop = () => {
  if (worker) {
    worker.postMessage({ kind: "stop" } as WasmWorkerRequest);
    log("stop requested");
  }
};

initBtn.addEventListener("click", () => void init());
voiceBtn.addEventListener("click", () => void prepareVoice());
playBtn.addEventListener("click", () => void startStream());
stopBtn.addEventListener("click", stop);
stopBtn.disabled = false;

log("ready");
