import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { clearCache, fetchWithCache, getCachedAsset, listCachedAssets, putCachedAsset } from "./cache";

describe("cache", () => {
  beforeEach(async () => {
    await clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a cached asset", async () => {
    const bytes = new Uint8Array([7, 8, 9, 10]);
    await putCachedAsset({
      key: "k1",
      bytes,
      contentType: "application/octet-stream",
      cachedAt: Date.now(),
      size: bytes.byteLength,
    });
    const fetched = await getCachedAsset("k1");
    expect(fetched).not.toBeNull();
    expect(fetched!.key).toBe("k1");
    expect(Array.from(fetched!.bytes)).toEqual([7, 8, 9, 10]);
  });

  it("returns null for a missing key", async () => {
    const fetched = await getCachedAsset("does-not-exist");
    expect(fetched).toBeNull();
  });

  it("overwrites an existing entry on put", async () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2, 3]);
    await putCachedAsset({ key: "dup", bytes: a, contentType: "x", cachedAt: 0, size: 1 });
    await putCachedAsset({ key: "dup", bytes: b, contentType: "x", cachedAt: 0, size: 2 });
    const fetched = await getCachedAsset("dup");
    expect(Array.from(fetched!.bytes)).toEqual([2, 3]);
    expect(fetched!.size).toBe(2);
  });

  it("listCachedAssets returns all entries", async () => {
    await putCachedAsset({ key: "a", bytes: new Uint8Array([1]), contentType: "x", cachedAt: 0, size: 1 });
    await putCachedAsset({ key: "b", bytes: new Uint8Array([2]), contentType: "x", cachedAt: 0, size: 1 });
    const all = await listCachedAssets();
    expect(all.map((a) => a.key).sort()).toEqual(["a", "b"]);
  });

  it("clearCache empties the store", async () => {
    await putCachedAsset({ key: "x", bytes: new Uint8Array([9]), contentType: "x", cachedAt: 0, size: 1 });
    await clearCache();
    const all = await listCachedAssets();
    expect(all).toEqual([]);
  });

  it("fetchWithCache downloads, caches, and returns on first call", async () => {
    const url = "https://example.com/weights.safetensors";
    const bytes = new Uint8Array([10, 20, 30]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength) },
      }),
    );
    const result = await fetchWithCache("weights:test", url);
    expect(Array.from(result)).toEqual([10, 20, 30]);
    expect(fetchSpy).toHaveBeenCalledWith(url);
    const cached = await getCachedAsset("weights:test");
    expect(cached).not.toBeNull();
  });

  it("fetchWithCache serves from cache on second call", async () => {
    const url = "https://example.com/voice.safetensors";
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    );
    await fetchWithCache("voice:test", url);
    const second = await fetchWithCache("voice:test", url);
    expect(Array.from(second)).toEqual([1, 2, 3, 4, 5]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fetchWithCache throws on HTTP error and does not cache", async () => {
    const url = "https://example.com/missing.safetensors";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await expect(fetchWithCache("missing:test", url)).rejects.toThrow(/404/);
    const cached = await getCachedAsset("missing:test");
    expect(cached).toBeNull();
  });

  it("fetchWithCache invokes onProgress with cumulative bytes", async () => {
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
    const result = await fetchWithCache("progress:test", url, (loaded) => {
      progress.push(loaded);
    });
    expect(result.byteLength).toBe(50);
    expect(progress[progress.length - 1]).toBe(50);
  });
});
