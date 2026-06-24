import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type ChromeMock = {
  runtime: {
    onInstalled: { addListener: ReturnType<typeof vi.fn> };
    onStartup: { addListener: ReturnType<typeof vi.fn> };
    onConnect: { addListener: ReturnType<typeof vi.fn> };
    onConnectListeners: Array<(port: MockPort) => void>;
    getURL: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
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
  disconnect: ReturnType<typeof vi.fn>;
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
    disconnect: vi.fn(),
  };
};

const setupChrome = () => {
  const chromeMock: ChromeMock = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
      onConnectListeners: [],
      getURL: vi.fn((p: string) => `chrome-extension://abc/${p}`),
      connect: vi.fn(),
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
  });

  it("ignores ports with non-matching names", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const port: MockPort = makePort("other-name");
    onConnect(port);
    await waitMicrotasks();
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("sets up offscreen port when offscreen connects", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();
    expect(osp.onMessage.addListener).toHaveBeenCalled();
    expect(osp.onDisconnect.addListener).toHaveBeenCalled();
  });

  it("replaces old offscreen port on reconnection", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);
    const osp1 = makePort("pocket-tts-offscreen");
    onConnect(osp1);
    await waitMicrotasks();

    const osp2 = makePort("pocket-tts-offscreen");
    onConnect(osp2);
    await waitMicrotasks();

    expect(osp1.disconnect).toHaveBeenCalled();
    expect(osp2.onMessage.addListener).toHaveBeenCalled();
  });

  it("forwards content port messages to offscreen port", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    // Offscreen connects first
    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    // Content port connects
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();

    // Send a message on the content port
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();

    expect(osp.postMessage).toHaveBeenCalledWith({
      kind: "wasm_request",
      portId: expect.any(Number),
      msg: { kind: "init" },
    });
  });

  it("queues content port messages until offscreen port connects", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    // Content port connects first (no offscreen port yet)
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();

    // Send a message — should be pending
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();

    // Verify not yet forwarded
    const ospCallCountBefore = (chromeMock.runtime.connect as ReturnType<typeof vi.fn>).mock.calls.length;

    // Offscreen connects — queued message should be forwarded
    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    expect(osp.postMessage).toHaveBeenCalledWith({
      kind: "wasm_request",
      portId: expect.any(Number),
      msg: { kind: "init" },
    });
  });

  it("routes worker_event from offscreen port to content port", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    // Offscreen connects
    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    // Content port connects
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();

    // Forward a message to get the portId
    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();

    const call = osp.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { kind: string })?.kind === "wasm_request"
    );
    const portId = (call?.[0] as { portId?: number })?.portId;

    // Offscreen sends a worker_event back
    firstListener(osp.onMessageListeners)({
      kind: "worker_event",
      portId,
      event: { kind: "status", status: { phase: "ready", progress: 100 } },
    });

    expect(port.postMessage).toHaveBeenCalledWith({
      kind: "status",
      status: { phase: "ready", progress: 100 },
    });
  });

  it("routes worker_error from offscreen port as stream_error", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();

    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();

    const call = osp.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { kind: string })?.kind === "wasm_request"
    );
    const portId = (call?.[0] as { portId?: number })?.portId;

    firstListener(osp.onMessageListeners)({
      kind: "worker_error",
      portId,
      error: "boom",
    });

    expect(port.postMessage).toHaveBeenCalledWith({ kind: "stream_error", error: "boom" });
  });

  it("warns and drops worker_event for unknown portId", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    firstListener(osp.onMessageListeners)({
      kind: "worker_event",
      portId: 999,
      event: { kind: "rpc_ok", requestId: 1 },
    });
    expect(warn).toHaveBeenCalled();
  });

  it("removes content port on disconnect so stale worker events are dropped", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();

    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();

    const call = osp.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { kind: string })?.kind === "wasm_request"
    );
    const portId = (call?.[0] as { portId?: number })?.portId;

    // Disconnect the content port
    firstListener(port.onDisconnectListeners)();

    // Worker event for the disconnected port should be dropped
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    firstListener(osp.onMessageListeners)({
      kind: "worker_event",
      portId,
      event: { kind: "rpc_ok", requestId: 1 },
    });
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("clears offscreen port state on offscreen port disconnect", async () => {
    await importBackground();
    const onConnect = firstArg<(port: MockPort) => void>(chromeMock.runtime.onConnect.addListener);

    const osp = makePort("pocket-tts-offscreen");
    onConnect(osp);
    await waitMicrotasks();

    // Disconnect the offscreen port
    firstListener(osp.onDisconnectListeners)();
    await waitMicrotasks();

    // Content port connects — should wait for new offscreen port
    const port: MockPort = makePort("pocket-tts-worker");
    onConnect(port);
    await waitMicrotasks();

    firstListener(port.onMessageListeners)({ kind: "init" });
    await waitMicrotasks();

    // Message should NOT have been forwarded (no offscreen port)
    expect(osp.postMessage).not.toHaveBeenCalled();

    // New offscreen connects
    const osp2 = makePort("pocket-tts-offscreen");
    onConnect(osp2);
    await waitMicrotasks();

    // Now the queued message should be forwarded
    expect(osp2.postMessage).toHaveBeenCalledWith({
      kind: "wasm_request",
      portId: expect.any(Number),
      msg: { kind: "init" },
    });
  });
});
