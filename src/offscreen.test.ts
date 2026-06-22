import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type WorkerCtor = new (url: URL, opts?: { type?: string }) => MockWorker;

type MockWorker = {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

type ChromeMock = {
  runtime: {
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      listeners: Array<(msg: unknown) => void>;
    };
    sendMessage: ReturnType<typeof vi.fn>;
  };
};

const setupChrome = (): ChromeMock => {
  const mock: ChromeMock = {
    runtime: {
      onMessage: { addListener: vi.fn(), listeners: [] },
      sendMessage: vi.fn().mockResolvedValue(undefined),
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

  beforeEach(() => {
    chromeMock = setupChrome();
    const wg = setupWorkerGlobal();
    instances = wg.instances;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { chrome?: unknown; Worker?: unknown }).chrome;
    delete (globalThis as unknown as { Worker?: unknown }).Worker;
  });

  it("registers a chrome.runtime.onMessage listener on import", async () => {
    await importOffscreen();
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it("sends an offscreen_ready signal to the SW on import", async () => {
    await importOffscreen();
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: "offscreen_ready",
    });
  });

  it("registers the onMessage listener before sending offscreen_ready", async () => {
    await importOffscreen();
    const addListenerOrder = chromeMock.runtime.onMessage.addListener.mock.invocationCallOrder[0]!;
    const sendMessageOrder = chromeMock.runtime.sendMessage.mock.invocationCallOrder[0]!;
    expect(addListenerOrder).toBeLessThan(sendMessageOrder);
  });

  it("forwards wasm_request to worker.postMessage", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 7, msg: { kind: "init", foo: 1 } });
    await waitMicrotasks();
    expect(instances).toHaveLength(1);
    const w = firstWorker(instances);
    expect(w.postMessage).toHaveBeenCalledWith({ kind: "init", foo: 1 });
  });

  it("reuses the same worker across messages", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 1, msg: { kind: "init" } });
    listener({ kind: "wasm_request", portId: 2, msg: { kind: "stop" } });
    await waitMicrotasks();
    expect(instances).toHaveLength(1);
    const w = firstWorker(instances);
    expect(w.postMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores messages without wasm_request kind", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "worker_event", portId: 1, event: {} });
    listener(null);
    await waitMicrotasks();
    const w = firstWorker(instances);
    expect(w.postMessage).not.toHaveBeenCalled();
  });

  it("forwards worker.onmessage to chrome.runtime.sendMessage with active portId", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 42, msg: { kind: "init" } });
    await waitMicrotasks();
    firstWorker(instances).onmessage?.({ data: { kind: "status", status: { phase: "ready" } } } as MessageEvent);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      kind: "worker_event",
      portId: 42,
      event: { kind: "status", status: { phase: "ready" } },
    });
  });

  it("updates active portId on each wasm_request", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 5, msg: { kind: "init" } });
    await waitMicrotasks();
    listener({ kind: "wasm_request", portId: 9, msg: { kind: "stop" } });
    await waitMicrotasks();
    firstWorker(instances).onmessage?.({ data: { kind: "rpc_ok", requestId: 1 } } as MessageEvent);
    expect(chromeMock.runtime.sendMessage).toHaveBeenLastCalledWith({
      kind: "worker_event",
      portId: 9,
      event: { kind: "rpc_ok", requestId: 1 },
    });
  });

  it("drops worker events when there is no active port", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await importOffscreen();
    chromeMock.runtime.sendMessage.mockClear();
    firstWorker(instances).onmessage?.({ data: { kind: "rpc_ok", requestId: 1 } } as MessageEvent);
    expect(chromeMock.runtime.sendMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("forwards worker.onerror as worker_error to active port", async () => {
    await importOffscreen();
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 11, msg: { kind: "init" } });
    await waitMicrotasks();
    firstWorker(instances).onerror?.({ message: "boom" } as ErrorEvent);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
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
    const listener = firstArg<(msg: unknown) => void>(chromeMock.runtime.onMessage.addListener);
    listener({ kind: "wasm_request", portId: 1, msg: { kind: "init" } });
    await waitMicrotasks();
    expect(err).toHaveBeenCalled();
  });
});
