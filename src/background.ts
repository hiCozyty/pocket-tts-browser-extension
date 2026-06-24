/// <reference lib="webworker" />

const PORT_NAME = "pocket-tts-worker";
const OFFSCREEN_PORT_NAME = "pocket-tts-offscreen";
const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

const closeOffscreenDocument = async (): Promise<void> => {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) {
      await chrome.offscreen.closeDocument?.();
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.warn("[Pocket TTS] bg: failed to close offscreen document", m);
  }
};

chrome.runtime.onInstalled.addListener((details) => {
  void closeOffscreenDocument();
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage?.();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void closeOffscreenDocument();
});

chrome.action.onClicked.addListener(() => {
  // No-op; clicking the action opens the popup defined in manifest.json.
});

const ports = new Map<number, chrome.runtime.Port>();
let nextPortId = 1;

let offscreenPort: chrome.runtime.Port | null = null;
let offscreenPortResolve: ((p: chrome.runtime.Port) => void) | null = null;
let offscreenPortPromise: Promise<chrome.runtime.Port> | null = null;

const ensureOffscreenDocument = async (): Promise<void> => {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run pocket-tts WASM in a Web Worker for TTS inference",
  });
};

const ensureOffscreenPort = (): Promise<chrome.runtime.Port> => {
  if (offscreenPort) return Promise.resolve(offscreenPort);
  if (!offscreenPortPromise) {
    offscreenPortPromise = new Promise((resolve) => {
      offscreenPortResolve = resolve;
    });
  }
  return offscreenPortPromise;
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === OFFSCREEN_PORT_NAME) {
    if (offscreenPort) {
      offscreenPort.disconnect();
    }
    offscreenPort = port;
    offscreenPortPromise = null;

    port.onMessage.addListener((workerMsg: { kind: string; portId: number; event?: unknown; error?: string }) => {
      if (workerMsg.kind === "worker_event") {
        const targetPort = ports.get(workerMsg.portId);
        if (!targetPort) {
          console.warn("[Pocket TTS] bg: no content port for worker_event", workerMsg.portId);
          return;
        }
        try {
          targetPort.postMessage(workerMsg.event);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          console.error("[Pocket TTS] bg: port.postMessage failed (worker_event)", m);
        }
      } else if (workerMsg.kind === "worker_error") {
        const targetPort = ports.get(workerMsg.portId);
        if (!targetPort) return;
        try {
          targetPort.postMessage({ kind: "stream_error", error: workerMsg.error ?? "Unknown worker error" });
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          console.error("[Pocket TTS] bg: port.postMessage failed (stream_error)", m);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      offscreenPort = null;
      offscreenPortPromise = null;
      offscreenPortResolve = null;
    });

    offscreenPortResolve?.(port);
    offscreenPortResolve = null;
    return;
  }

  if (port.name !== PORT_NAME) return;

  const portId = nextPortId++;
  ports.set(portId, port);

  port.onMessage.addListener((msg) => {
    ensureOffscreenDocument()
      .then(() => ensureOffscreenPort())
      .then((osp) => {
        osp.postMessage({ kind: "wasm_request", portId, msg });
      })
      .catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        try {
          port.postMessage({ kind: "stream_error", error: `Offscreen setup failed: ${m}` });
        } catch {}
      });
  });

  port.onDisconnect.addListener(() => {
    ports.delete(portId);
  });
});

export {};
