/// <reference lib="webworker" />

import type { WasmWorkerEvent, WasmWorkerRequest } from "./protocol";
import { serializeFloat32Array } from "./protocol";
import WasmTtsWorker from "./wasm-tts.worker.ts?worker";

type WasmRequest = { kind: "wasm_request"; portId: number; msg: WasmWorkerRequest };
type WorkerEvent = { kind: "worker_event"; portId: number; event: WasmWorkerEvent };
type WorkerError = { kind: "worker_error"; portId: number; error: string };

let worker: Worker | null = null;
let activePortId: number | null = null;

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
      const receivedAt = Date.now();
      eventToSend = { ...ev, chunk: serializeFloat32Array(chunk) } as WasmWorkerEvent;
      console.log("[Pocket TTS] offscreen: chunk", {
        receivedAt,
        serializedAt: Date.now(),
        chunkLength: chunk.length,
      });
    }
    if (activePortId == null) {
      return;
    }
    const payload: WorkerEvent = { kind: "worker_event", portId: activePortId, event: eventToSend };
    try {
      chrome.runtime.sendMessage(payload).catch((err) => {
        console.error("[Pocket TTS] offscreen: sendMessage failed", err);
      });
    } catch (err) {
      console.error("[Pocket TTS] offscreen: sendMessage threw", err);
    }
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
    try {
      chrome.runtime.sendMessage(payload).catch(() => undefined);
    } catch {}
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

chrome.runtime.onMessage.addListener((message: WasmRequest, _sender, _sendResponse) => {
  if (!message || message.kind !== "wasm_request") {
    return false;
  }

  activePortId = message.portId;
  try {
    ensureWorker().postMessage(message.msg);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[Pocket TTS] offscreen: postMessage failed", m);
  }
  return false;
});

ensureWorker();

chrome.runtime
  .sendMessage({ kind: "offscreen_ready" })
  .catch((err: unknown) => {
    const m = err instanceof Error ? err.message : String(err);
    console.warn("[Pocket TTS] offscreen: ready signal failed", m);
  });
