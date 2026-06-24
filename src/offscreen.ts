/// <reference lib="webworker" />

import type { WasmWorkerEvent, WasmWorkerRequest } from "./protocol";
import { serializeFloat32Array } from "./protocol";
import WasmTtsWorker from "./wasm-tts.worker.ts?worker";

type WasmRequest = { kind: "wasm_request"; portId: number; msg: WasmWorkerRequest };
type WorkerEvent = { kind: "worker_event"; portId: number; event: WasmWorkerEvent };
type WorkerError = { kind: "worker_error"; portId: number; error: string };

let worker: Worker | null = null;
let activePortId: number | null = null;
let bgPort: chrome.runtime.Port | null = null;

const sendToBackground = (payload: WorkerEvent | WorkerError): void => {
  if (!bgPort) {
    console.warn("[Pocket TTS] offscreen: no bgPort, dropping event");
    return;
  }
  try {
    bgPort.postMessage(payload);
  } catch (err) {
    console.error("[Pocket TTS] offscreen: bgPort.postMessage threw", err);
  }
};

const spawnWorker = (): Worker => {
  let w: Worker;
  try {
    w = new WasmTtsWorker();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[Pocket TTS] offscreen: new Worker threw", m);
    throw err;
  }

  w.onmessage = (e: MessageEvent<WasmWorkerEvent>) => {
    const ev = e.data;
    let eventToSend: WasmWorkerEvent = ev;
    if (ev && typeof ev === "object" && "kind" in ev && ev.kind === "stream_chunk") {
      const chunk = ev.chunk as Float32Array;
      eventToSend = { ...ev, chunk: serializeFloat32Array(chunk) } as WasmWorkerEvent;
    }
    if (activePortId == null) {
      console.warn("[Pocket TTS] offscreen: dropping worker event, no activePortId", { eventKind: ev.kind });
      return;
    }
    const payload: WorkerEvent = { kind: "worker_event", portId: activePortId, event: eventToSend };
    sendToBackground(payload);
  };

  w.onerror = (e: ErrorEvent) => {
    const details = {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error instanceof Error ? e.error.stack || e.error.message : String(e.error),
      type: e.type,
    };
    const parts = [e.message].filter(Boolean);
    if (e.filename) parts.push(`@ ${e.filename}:${e.lineno}:${e.colno}`);
    const summary = parts.join(" ") || "Worker error";
    console.error("[Pocket TTS] offscreen: worker error", summary, details);
    if (activePortId == null) return;
    const payload: WorkerError = { kind: "worker_error", portId: activePortId, error: summary };
    sendToBackground(payload);
    worker = null;
  };

  w.onmessageerror = (e: MessageEvent) => {
    console.error("[Pocket TTS] offscreen: worker message error", e.data);
  };

  return w;
};

const ensureWorker = (): Worker => {
  if (!worker) {
    worker = spawnWorker();
  }
  return worker;
};

const connectToBackground = (): void => {
  try {
    const port = chrome.runtime.connect({ name: "pocket-tts-offscreen" });
    bgPort = port;

    port.onMessage.addListener((wrapper: WasmRequest) => {
      if (!wrapper || wrapper.kind !== "wasm_request") return;
      activePortId = wrapper.portId;
      try {
        ensureWorker().postMessage(wrapper.msg);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[Pocket TTS] offscreen: postMessage to worker failed", m);
      }
    });

    port.onDisconnect.addListener(() => {
      bgPort = null;
      setTimeout(connectToBackground, 100);
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[Pocket TTS] offscreen: connectToBackground failed", m);
    setTimeout(connectToBackground, 1000);
  }
};

ensureWorker();
connectToBackground();
