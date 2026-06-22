/// <reference lib="webworker" />

const DB_NAME = "pocket-tts-cache";
const DB_VERSION = 1;
const STORE_NAME = "assets";

interface CachedAsset {
  key: string;
  bytes: Uint8Array;
  contentType: string;
  cachedAt: number;
  size: number;
}

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const getCachedAsset = async (key: string): Promise<CachedAsset | null> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      const result = req.result as CachedAsset | undefined;
      db.close();
      resolve(result ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
};

const putCachedAsset = async (asset: CachedAsset): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(asset);
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
};

export const workerCache = {
  async fetchWithCache(
    key: string,
    url: string,
    onProgress?: (loaded: number, total: number | null) => void,
  ): Promise<Uint8Array> {
    const cached = await getCachedAsset(key);
    if (cached) {
      return cached.bytes;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} (${response.status})`);
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : null;
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    if (!reader) {
      const buf = new Uint8Array(await response.arrayBuffer());
      return buf;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
    }

    const totalSize = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    await putCachedAsset({
      key,
      bytes: combined,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      cachedAt: Date.now(),
      size: totalSize,
    });

    return combined;
  },
};

export {};
