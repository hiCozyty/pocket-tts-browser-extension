import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type ChromeMock = {
  runtime: {
    onInstalled: { addListener: ReturnType<typeof vi.fn> };
    onStartup: { addListener: ReturnType<typeof vi.fn> };
    onConnect: { addListener: ReturnType<typeof vi.fn> };
    onMessage: { addListener: ReturnType<typeof vi.fn> };
    onMessageListeners: Array<(msg: unknown) => void>;
    getURL: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    offscreen: {
      hasDocument: ReturnType<typeof vi.fn>;
      createDocument: ReturnType<typeof vi.fn>;
      closeDocument: ReturnType<typeof vi.fn>;
      Reason: { WORKERS: string };
    };
  };
  action: {
    onClicked: { addListener: ReturnType<typeof vi.fn> };
  };
  offscreen: {
    hasDocument: ReturnType<typeof vi.fn>;
    createDocument: ReturnType<typeof vi.fn>;
    closeDocument: ReturnType<typeof vi.fn>;
    Reason: { WORKERS: string };
  };
};

type MockPort = {
  name: string;
  onMessage: { addListener: ReturnType<typeof vi.fn> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn> };
  onMessageListeners: Array<(msg: unknown) => void>;
  onDisconnectListeners: Array<() => void>;
  postMessage: ReturnType<typeof vi.fn>;
};

const makePort = (name: string): MockPort => {
  const onMessageListeners: Array<(msg: unknown) => void> = [];
  const onDisconnectListeners: Array<() => void> = [];
  return {
    name,
    onMessage: { addListener: vi.fn((l: (msg: unknown) => void) => onMessageListeners.push(l)) },
    onDisconnect: { addListener: vi.fn((l: () => void) => onDisconnectListeners.push(l)) },
    onMessageListeners,
    onDisconnectListeners,
    postMessage: vi.fn(),
  };
};

const setupChrome = () => {
  const chromeMock: ChromeMock = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onMessageListeners: [],
      getURL: vi.fn((p: string) => `chrome-extension://abc/${p}`),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(false),
        createDocument: vi.fn().mockResolvedValue(undefined),
        closeDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: "WORKERS" },
      },
    },
    offscreen: {
      hasDocument: vi.fn().mockResolvedValue(false),
      createDocument: vi.fn().mockResolvedValue(undefined),
      closeDocument: vi.fn().mockResolvedValue(undefined),
      Reason: { WORKERS: "WORKERS" },
    },
    action: {
      onClicked: { addListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock;
  return { chromeMock };
};

const importBackground = async () => {
  vi.resetModules();
  await import("./background");
};

const waitMicrotasks = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const firstArg = <T,>(fn: ReturnType<typeof vi.fn>): T => {
  const calls = fn.mock.calls[0];
  if (!calls) throw new Error("function was not called");
  return calls[0] as T;
};

const firstListener = <T,>(arr: T[]): T => {
  if (!arr[0]) throw new Error("no listener registered");
  return arr[0];
};

describe("background", () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    const setup = setupChrome();
    chromeMock = setup.chromeMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("registers onInstalled and onConnect on import", async () => {
    await importBackground();
    expect(chromeMock.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.onConnect.addListener).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it("ignores ports with non-matching names", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("other-name");
    onConnect(port);
    await waitMicrotasks();
    expect(chromeMock.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it("ensures offscreen document on port connect and creates one if missing", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    await waitMicrotasks();
    expect(chromeMock.offscreen.hasDocument).toHaveBeenCalled();
    expect(chromeMock.offscreen.createDocument).toHaveBeenCalledWith({
      url: "chrome-extension://abc/offscreen.html",
      reasons: ["WORKERS"],
      justification: expect.any(String),
    });
  });

  it("does not recreate offscreen document if one already exists", async () => {
    chromeMock.offscreen.hasDocument.mockResolvedValue(true);
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    onConnect(makePort("pocket-tts-worker"));
    await waitMicrotasks();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    await waitMicrotasks();
    expect(chromeMock.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it("recognizes offscreen_ready and resolves the ready gate", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();

    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    await waitMicrotasks();

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: "wasm_request",
      portId: expect.any(Number),
      msg: { kind: "init" },
    });
    expect(log).toHaveBeenCalledWith("[Pocket TTS] bg: offscreen ready");
  });

  it("forwards port messages to offscreen via sendMessage", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    await waitMicrotasks();
    firstListener(port.onMessageListeners)({ kind: "init", foo: 1 });
    await waitMicrotasks();
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: "wasm_request",
      portId: expect.any(Number),
      msg: { kind: "init", foo: 1 },
    });
  });

  it("does not forward port messages until offscreen_ready is received", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("routes worker_event back to the originating port", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    await waitMicrotasks();
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();
    const portId = (chromeMock.runtime.sendMessage.mock.calls[0]?.[0] as { portId?: number } | undefined)
      ?.portId;
    expect(typeof portId).toBe("number");

    onMessage({ kind: "worker_event", portId, event: { kind: "status", status: { phase: "ready", progress: 100 } } });
    expect(port.postMessage).toHaveBeenCalledWith({
      kind: "status",
      status: { phase: "ready", progress: 100 },
    });
  });

  it("routes worker_error to port as stream_error", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    await waitMicrotasks();
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();
    const portId = (chromeMock.runtime.sendMessage.mock.calls[0]?.[0] as { portId?: number } | undefined)
      ?.portId;

    onMessage({ kind: "worker_error", portId, error: "boom" });
    expect(port.postMessage).toHaveBeenCalledWith({ kind: "stream_error", error: "boom" });
  });

  it("ignores unknown message kinds", async () => {
    await importBackground();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "something_else" });
    onMessage(null);
    onMessage(undefined);
  });

  it("warns and drops worker_event for unknown portId", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await importBackground();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "worker_event", portId: 999, event: { kind: "rpc_ok", requestId: 1 } });
    expect(warn).toHaveBeenCalled();
  });

  it("posts stream_error to port when ensureOffscreen fails", async () => {
    chromeMock.offscreen.createDocument.mockRejectedValue(new Error("nope"));
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();
    expect(port.postMessage).toHaveBeenCalledWith({
      kind: "stream_error",
      error: expect.stringContaining("Offscreen setup failed"),
    });
  });

  it("removes port on disconnect", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();
    const onMessage = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    onMessage({ kind: "offscreen_ready" });
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();
    firstListener(port.onDisconnectListeners)();
    onMessage({ kind: "worker_event", portId: 1, event: { kind: "rpc_ok", requestId: 1 } });
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});
