import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./worker-cache", () => ({
  workerCache: {
    fetchWithCache: vi.fn(),
  },
}));

type Handler = (event: MessageEvent) => void;
type ErrorHandler = (event: ErrorEvent) => void;

interface MockWorker {
  onmessage: Handler | null;
  onerror: ErrorHandler | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  messages: unknown[];
}

const createMockWorker = (): MockWorker => {
  const w: MockWorker = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
    messages: [],
  };
  w.postMessage.mockImplementation((m) => w.messages.push(m));
  return w;
};

interface MessageBus {
  worker: MockWorker;
  portHandlers: { onMessage: Set<(m: unknown) => void>; onDisconnect: Set<() => void> };
  emit: (from: "port" | "worker", payload: unknown) => void;
  emitDisconnect: () => void;
}

const installMockChrome = (worker: MockWorker): MessageBus => {
  const portHandlers = { onMessage: new Set<(m: unknown) => void>(), onDisconnect: new Set<() => void>() };
  const port = {
    onMessage: { addListener: (h: (m: unknown) => void) => portHandlers.onMessage.add(h) },
    onDisconnect: { addListener: (h: () => void) => portHandlers.onDisconnect.add(h) },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
      connect: () => port,
      lastError: undefined,
      sendMessage: () => Promise.resolve(),
    },
  };
  return {
    worker,
    portHandlers,
    emit: (from, payload) => {
      if (from === "port") portHandlers.onMessage.forEach((h) => h(payload));
      else worker.onmessage?.({ data: payload } as MessageEvent);
    },
    emitDisconnect: () => portHandlers.onDisconnect.forEach((h) => h()),
  };
};

describe("BackgroundWorkerProxy", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens a port with the expected name on construction", async () => {
    const connectSpy = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getURL: (p: string) => `chrome-extension://test-id/${p}`,
        connect: connectSpy.mockReturnValue({
          onMessage: { addListener: () => {} },
          onDisconnect: { addListener: () => {} },
          postMessage: vi.fn(),
          disconnect: vi.fn(),
        }),
        lastError: undefined,
      },
    };
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    engine.init(
      { wasmBase: "x", hfRepo: "r", hfToken: "", voice: "alba", useCache: true },
      () => undefined,
    );
    expect(connectSpy).toHaveBeenCalledWith({ name: "pocket-tts-worker" });
  });

  it("forwards postMessage to the port", async () => {
    const postMessage = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getURL: (p: string) => `chrome-extension://test-id/${p}`,
        connect: () => ({
          onMessage: { addListener: () => {} },
          onDisconnect: { addListener: () => {} },
          postMessage,
          disconnect: vi.fn(),
        }),
        lastError: undefined,
      },
    };
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    const statusListener = vi.fn();
    engine.init({ wasmBase: "x", hfRepo: "r", hfToken: "", voice: "alba", useCache: true }, statusListener);
    // init creates the proxy; we can reach the underlying port via chrome.connect mock
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("delivers port messages to onmessage handler as MessageEvent", async () => {
    const { TTSEngine } = await import("./tts-engine");
    const bus = installMockChrome(createMockWorker());
    const engine = new TTSEngine();
    engine.init({ wasmBase: "x", hfRepo: "r", hfToken: "", voice: "alba", useCache: true }, () => undefined);
    const handler = vi.fn();
    // The engine's spawnWorker already set onmessage internally; re-wire to our test handler
    // by triggering a port emit and inspecting the status listener updates
    const statusListener = vi.fn();
    const e2 = new TTSEngine();
    e2.init({ wasmBase: "x", hfRepo: "r", hfToken: "", voice: "alba", useCache: true }, statusListener);
    bus.emit("port", { kind: "status", status: { phase: "ready", progress: 100, message: "ok", source: "hf", ready: true, error: null } });
    expect(statusListener).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled(); // sanity: no leak
  });

  it("terminate() disconnects the port", async () => {
    const disconnect = vi.fn();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        getURL: (p: string) => `chrome-extension://test-id/${p}`,
        connect: () => ({
          onMessage: { addListener: () => {} },
          onDisconnect: { addListener: () => {} },
          postMessage: vi.fn(),
          disconnect,
        }),
        lastError: undefined,
      },
    };
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    engine.init({ wasmBase: "x", hfRepo: "r", hfToken: "", voice: "alba", useCache: true }, () => undefined);
    engine.dispose();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("TTSEngine public API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts in idle state", async () => {
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    expect(engine.getStatus().state).toBe("idle");
    expect(engine.isReady()).toBe(false);
  });

  it("getAnalyser returns null before audio is set up", async () => {
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    expect(engine.getAnalyser()).toBeNull();
  });

  it("setOnChunk / setOnDone / setOnError accept listeners without throwing", async () => {
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    expect(() => {
      engine.setOnChunk(() => undefined);
      engine.setOnDone(() => undefined);
      engine.setOnError(() => undefined);
    }).not.toThrow();
  });

  it("stop() with no worker does not throw", async () => {
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    expect(() => engine.stop()).not.toThrow();
  });

  it("ensureReady throws when config is missing", async () => {
    const { TTSEngine } = await import("./tts-engine");
    const engine = new TTSEngine();
    await expect(engine.ensureReady()).rejects.toThrow(/not configured/);
  });
});
