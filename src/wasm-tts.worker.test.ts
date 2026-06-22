import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("./worker-cache", () => ({
  workerCache: {
    fetchWithCache: vi.fn(async (key: string) => {
      if (key.startsWith("weights:")) return new Uint8Array([0, 1, 2, 3, 4]);
      if (key.startsWith("voice:")) return new Uint8Array([5, 6, 7, 8]);
      throw new Error("unexpected key: " + key);
    }),
  },
}));

interface PostCall {
  event: unknown;
  transfer: Transferable[];
}

interface MockSelf {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, handler: (e: unknown) => void) => void;
}

const setupWorkerEnv = () => {
  const posts: PostCall[] = [];
  const mockSelf: MockSelf = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn((event: unknown, transfer: Transferable[] = []) => {
      posts.push({ event, transfer });
    }),
    addEventListener: () => undefined,
  };
  (globalThis as unknown as { self: MockSelf }).self = mockSelf;
  return { mockSelf, posts };
};

const loadWorkerModule = async () => {
  vi.resetModules();
  await import("./wasm-tts.worker");
};

const emitMessage = (msg: unknown) => {
  const w = (globalThis as unknown as { self: MockSelf }).self;
  if (!w.onmessage) throw new Error("worker onmessage not set");
  w.onmessage({ data: msg } as MessageEvent);
};

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const findPost = (posts: PostCall[], predicate: (e: any) => boolean) =>
  posts.find((p) => predicate(p.event));

describe("wasm-tts.worker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs onmessage handler on import", async () => {
    const { mockSelf } = setupWorkerEnv();
    await loadWorkerModule();
    expect(mockSelf.onmessage).toBeTypeOf("function");
  });

  it("ignores non-object messages", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage(null);
    emitMessage("string");
    emitMessage(42);
    await flush();
    expect(posts).toEqual([]);
  });

  it("init: posts rpc_err when wasm runtime cannot be loaded", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage({
      kind: "init",
      requestId: 99,
      wasmBase: "this-path-does-not-exist",
      hfRepo: "r",
      hfToken: "",
      useCache: true,
    });
    await flush();

    const err = findPost(
      posts,
      (e) => e.kind === "rpc_err" && e.requestId === 99,
    );
    expect(err).toBeDefined();
    const error = (err!.event as { error: string }).error;
    expect(error.length).toBeGreaterThan(0);
  });

  it("init: posts initializing-runtime status before failing", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage({
      kind: "init",
      requestId: 1,
      wasmBase: "missing",
      hfRepo: "r",
      hfToken: "",
      useCache: true,
    });
    await flush();
    const status = findPost(posts, (e) => e.kind === "status" && e.status?.phase === "initializing-runtime");
    expect(status).toBeDefined();
    expect((status!.event as any).status.progress).toBe(10);
  });

  it("stop: does not post rpc_err (control message)", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage({ kind: "stop" });
    await flush();
    const err = findPost(posts, (e) => e.kind === "rpc_err");
    expect(err).toBeUndefined();
  });

  it("prepare_voice: rejects when model is not ready (covers unknown voice too)", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage({
      kind: "prepare_voice",
      requestId: 7,
      voice: { kind: "preset", voice: "not-a-voice", hfRepo: "r", hfToken: "" },
    });
    await flush();
    const err = findPost(posts, (e) => e.kind === "rpc_err" && e.requestId === 7);
    expect(err).toBeDefined();
    expect((err!.event as any).error).toMatch(/not initialized/);
  });

  it("prepare_voice: rejects when model is not ready (valid preset)", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage({
      kind: "prepare_voice",
      requestId: 8,
      voice: { kind: "preset", voice: "alba", hfRepo: "r", hfToken: "" },
    });
    await flush();
    const err = findPost(posts, (e) => e.kind === "rpc_err" && e.requestId === 8);
    expect(err).toBeDefined();
    expect((err!.event as any).error).toMatch(/not initialized/);
  });

  it("start_stream: rejects when model is not ready", async () => {
    const { posts } = setupWorkerEnv();
    await loadWorkerModule();
    emitMessage({ kind: "start_stream", requestId: 12, text: "hello" });
    await flush();
    const err = findPost(posts, (e) => e.kind === "rpc_err" && e.requestId === 12);
    expect(err).toBeDefined();
    expect((err!.event as any).error).toMatch(/not initialized/);
  });
});
