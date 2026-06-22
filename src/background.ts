/// <reference lib="webworker" />

const PORT_NAME = "pocket-tts-worker";
const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

const closeOffscreenDocument = async (): Promise<void> => {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) {
      console.log("[Pocket TTS] bg: closing stale offscreen document");
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

type IncomingMessage =
  | { kind: "worker_event"; portId: number; event: unknown }
  | { kind: "worker_error"; portId: number; error: string }
  | { kind: "offscreen_ready" };

const ports = new Map<number, chrome.runtime.Port>();
let nextPortId = 1;

let offscreenReadyPromise: Promise<void> | null = null;
let offscreenReadyResolver: (() => void) | null = null;
let offscreenReadyReceived = false;

const ensureOffscreenDocument = async (): Promise<void> => {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) {
    console.log("[Pocket TTS] bg: offscreen document already exists");
    return;
  }
  console.log("[Pocket TTS] bg: creating offscreen document");
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run pocket-tts WASM in a Web Worker for TTS inference",
  });
};

const getOffscreenReady = (): Promise<void> => {
  if (offscreenReadyPromise) return offscreenReadyPromise;
  offscreenReadyPromise = (async () => {
    await ensureOffscreenDocument();
    if (offscreenReadyReceived) return;
    console.log("[Pocket TTS] bg: waiting for offscreen ready signal");
    await new Promise<void>((resolve) => {
      offscreenReadyResolver = resolve;
    });
    console.log("[Pocket TTS] bg: offscreen ready");
  })();
  return offscreenReadyPromise;
};

chrome.runtime.onMessage.addListener((message: IncomingMessage) => {
  if (!message || typeof message !== "object") return;
  if (message.kind === "offscreen_ready") {
    offscreenReadyReceived = true;
    offscreenReadyResolver?.();
    offscreenReadyResolver = null;
    return;
  }
  if (message.kind !== "worker_event" && message.kind !== "worker_error") return;

  const port = ports.get(message.portId);
  if (!port) {
    console.warn("[Pocket TTS] bg: no port for", message.kind, message.portId);
    return;
  }

  if (message.kind === "worker_event") {
    const ev = message.event;
    if (ev && typeof ev === "object" && "kind" in ev && ev.kind === "stream_chunk") {
      const chunk = (ev as { chunk?: unknown }).chunk;
      console.log("[Pocket TTS] bg: forwarding stream_chunk", {
        chunkType: typeof chunk,
        chunkConstructor: chunk?.constructor?.name,
        chunkLength: (chunk as { length?: number } | undefined)?.length,
      });
    }
  }

  try {
    if (message.kind === "worker_error") {
      port.postMessage({ kind: "stream_error", error: message.error });
    } else {
      port.postMessage(message.event);
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[Pocket TTS] bg: port.postMessage failed", m);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  console.log("[Pocket TTS] bg: port connected");

  const portId = nextPortId++;
  ports.set(portId, port);

  const sendToOffscreen = (msg: unknown) => {
    chrome.runtime.sendMessage({ kind: "wasm_request", portId, msg }).catch((err) => {
      const m = err instanceof Error ? err.message : String(err);
      console.error("[Pocket TTS] bg: sendMessage to offscreen failed", m);
    });
  };

  port.onMessage.addListener((msg) => {
    getOffscreenReady()
      .then(() => {
        console.log("[Pocket TTS] bg: forwarding to offscreen", {
          portId,
          msgKind: (msg as { kind?: string })?.kind,
        });
        sendToOffscreen(msg);
      })
      .catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        console.error("[Pocket TTS] bg: getOffscreenReady failed", m);
        try {
          port.postMessage({ kind: "stream_error", error: `Offscreen setup failed: ${m}` });
        } catch {}
      });
  });

  port.onDisconnect.addListener(() => {
    console.log("[Pocket TTS] bg: port disconnected", portId);
    ports.delete(portId);
  });

  getOffscreenReady().catch((err) => {
    const m = err instanceof Error ? err.message : String(err);
    console.error("[Pocket TTS] bg: getOffscreenReady failed (eager)", m);
    try {
      port.postMessage({ kind: "stream_error", error: `Offscreen setup failed: ${m}` });
    } catch {}
  });
});

export {};
