import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type WorkerCtor = new (url: URL, opts?: { type?: string }) => MockWorker;

type MockWorker = {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
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

type ChromeMock = {
  runtime: {
    connect: ReturnType<typeof vi.fn>;
  };
};

const setupChrome = (): ChromeMock => {
  const mock: ChromeMock = {
    runtime: {
      connect: vi.fn(() => makePort("pocket-tts-offscreen")),
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
};

const setupWorkerGlobal = () => {
  const instances: MockWorker[] = [];
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    onmessageerror: ((e: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    constructor(_url: URL, _opts?: { type?: string }) {
      instances.push(this as unknown as MockWorker);
    }
  }
  (globalThis as unknown as { Worker: WorkerCtor }).Worker =
    FakeWorker as unknown as WorkerCtor;
  return { Worker: FakeWorker as unknown as WorkerCtor, instances };
};

const importOffscreen = async () => {
  vi.resetModules();
  await import("./offscreen");
};

const waitMicrotasks = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const firstArg = <T,>(fn: ReturnType<typeof vi.fn>): T => {
  const calls = fn.mock.calls[0];
  if (!calls) throw new Error("function was not called");
  return calls[0] as T;
};

const firstWorker = (instances: MockWorker[]): MockWorker => {
  const w = instances[0];
  if (!w) throw new Error("worker not constructed");
  return w;
};

describe("offscreen", () => {
  let chromeMock: ChromeMock;
  let instances: MockWorker[];
  let bgPort: MockPort;

  beforeEach(() => {
    chromeMock = setupChrome();
    const wg = setupWorkerGlobal();
    instances = wg.instances;
    bgPort = makePort("pocket-tts-offscreen");
    chromeMock.runtime.connect = vi.fn(() => bgPort);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { chrome?: unknown; Worker?: unknown }).chrome;
    delete (globalThis as unknown as { Worker?: unknown }).Worker;
  });

  it("connects to background via port on import", async () => {
    await importOffscreen();
    expect(chromeMock.runtime.connect).toHaveBeenCalledWith({ name: "pocket-tts-offscreen" });
  });

  it("registers onMessage and onDisconnect on the background port", async () => {
    await importOffscreen();
    expect(bgPort.onMessage.addListener).toHaveBeenCalled();
    expect(bgPort.onDisconnect.addListener).toHaveBeenCalled();
  });

  it("reconnects to background after port disconnect", async () => {
    vi.useFakeTimers();
    await importOffscreen();
    expect(chromeMock.runtime.connect).toHaveBeenCalledTimes(1);

    // Simulate SW dying — port disconnects
    firstArg<(msg: unknown) => void>(bgPort.onDisconnect.addListener)();
    await waitMicrotasks();

    // Reconnect timeout should be scheduled
    expect(chromeMock.runtime.connect).toHaveBeenCalledTimes(1); // hasn't fired yet

    vi.advanceTimersByTime(100);
    expect(chromeMock.runtime.connect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("spawns a worker on import", async () => {
    await importOffscreen();
    expect(instances).toHaveLength(1);
  });

  it("forwards wasm_request from background port to worker", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 7, msg: { kind: "init", foo: 1 } });
    await waitMicrotasks();
    expect(instances).toHaveLength(1);
    const w = firstWorker(instances);
    expect(w.postMessage).toHaveBeenCalledWith({ kind: "init", foo: 1 });
  });

  it("ignores non-wasm_request messages on background port", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "worker_event", portId: 1, event: {} });
    listener(null);
    await waitMicrotasks();
    const w = firstWorker(instances);
    expect(w.postMessage).not.toHaveBeenCalled();
  });

  it("reuses the same worker across messages", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 1, msg: { kind: "init" } });
    listener({ kind: "wasm_request", portId: 2, msg: { kind: "stop" } });
    await waitMicrotasks();
    expect(instances).toHaveLength(1);
    const w = firstWorker(instances);
    expect(w.postMessage).toHaveBeenCalledTimes(2);
  });

  it("forwards worker.onmessage events to background via bgPort.postMessage", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 42, msg: { kind: "init" } });
    await waitMicrotasks();
    firstWorker(instances).onmessage?.({ data: { kind: "status", status: { phase: "ready" } } } as MessageEvent);
    expect(bgPort.postMessage).toHaveBeenCalledWith({
      kind: "worker_event",
      portId: 42,
      event: { kind: "status", status: { phase: "ready" } },
    });
  });

  it("updates active portId on each wasm_request", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 5, msg: { kind: "init" } });
    await waitMicrotasks();
    listener({ kind: "wasm_request", portId: 9, msg: { kind: "stop" } });
    await waitMicrotasks();
    firstWorker(instances).onmessage?.({ data: { kind: "rpc_ok", requestId: 1 } } as MessageEvent);
    expect(bgPort.postMessage).toHaveBeenLastCalledWith({
      kind: "worker_event",
      portId: 9,
      event: { kind: "rpc_ok", requestId: 1 },
    });
  });

  it("drops worker events when there is no active port", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await importOffscreen();
    bgPort.postMessage.mockClear();
    // Worker fires before any wasm_request sets activePortId
    firstWorker(instances).onmessage?.({ data: { kind: "rpc_ok", requestId: 1 } } as MessageEvent);
    expect(bgPort.postMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("serializes stream_chunk Float32Array before posting to background", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 1, msg: { kind: "init" } });
    await waitMicrotasks();
    const chunk = new Float32Array([0.1, 0.2]);
    firstWorker(instances).onmessage?.({ data: { kind: "stream_chunk", chunk } } as MessageEvent);
    expect(bgPort.postMessage).toHaveBeenCalled();
    const call = bgPort.postMessage.mock.calls[0]?.[0] as { kind: string; event: { chunk: { __typedarray: string; data: string; length: number } } };
    expect(call.kind).toBe("worker_event");
    expect(call.event.chunk.__typedarray).toBe("Float32Array");
  });

  it("forwards worker.onerror as worker_error via bgPort", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 11, msg: { kind: "init" } });
    await waitMicrotasks();
    firstWorker(instances).onerror?.({ message: "boom" } as ErrorEvent);
    expect(bgPort.postMessage).toHaveBeenCalledWith({
      kind: "worker_error",
      portId: 11,
      error: "boom",
    });
  });

  it("continues to function after worker postMessage throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await importOffscreen();
    firstWorker(instances).postMessage.mockImplementation(() => {
      throw new Error("post failed");
    });
    const listener = firstArg<(msg: unknown) => void>(bgPort.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 1, msg: { kind: "init" } });
    await waitMicrotasks();
    expect(err).toHaveBeenCalled();
  });

  it("does not send offscreen_ready message (port connection replaces it)", async () => {
    await importOffscreen();
    // chrome.runtime.sendMessage should not be used for offscreen_ready
    // Port connection is the readiness signal
    expect(chromeMock.runtime.connect).toHaveBeenCalled();
  });
});
