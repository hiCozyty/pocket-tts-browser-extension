import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { workerCache } from "./worker-cache";

const DB_NAME = "pocket-tts-cache";

const seedCache = async (key: string, bytes: Uint8Array) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite");
    tx.objectStore("assets").put({ key, bytes, contentType: "application/octet-stream", cachedAt: Date.now(), size: bytes.byteLength });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

const clearDb = async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
};

describe("workerCache", () => {
  beforeEach(async () => {
    await clearDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the asset from cache when present", async () => {
    const url = "https://example.com/weights.safetensors";
    const expected = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await seedCache("weights:test", expected);
    const result = await workerCache.fetchWithCache("weights:test", url);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("downloads, caches, and returns on first fetch", async () => {
    const url = "https://example.com/voice.safetensors";
    const bytes = new Uint8Array([10, 20, 30]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength) },
      }),
    );
    const result = await workerCache.fetchWithCache("voice:test", url);
    expect(Array.from(result)).toEqual([10, 20, 30]);
    expect(fetchSpy).toHaveBeenCalledWith(url);

    const second = await workerCache.fetchWithCache("voice:test", url);
    expect(Array.from(second)).toEqual([10, 20, 30]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws on HTTP error and does not cache", async () => {
    const url = "https://example.com/missing.safetensors";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await expect(workerCache.fetchWithCache("missing:test", url)).rejects.toThrow(/404/);
  });

  it("invokes onProgress with cumulative bytes", async () => {
    const url = "https://example.com/progress.safetensors";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.enqueue(new Uint8Array(20));
        controller.enqueue(new Uint8Array(20));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "50" },
      }),
    );
    const progress: number[] = [];
    const result = await workerCache.fetchWithCache("progress:test", url, (loaded) => {
      progress.push(loaded);
    });
    expect(result.byteLength).toBe(50);
    expect(progress[progress.length - 1]).toBe(50);
  });
});
