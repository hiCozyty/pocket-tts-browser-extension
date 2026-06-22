import "fake-indexeddb/auto";

if (typeof globalThis.chrome === "undefined") {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
      connect: () => ({
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
        postMessage: () => {},
        disconnect: () => {},
      }),
      lastError: undefined,
      sendMessage: () => Promise.resolve(),
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
      },
    },
  };
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
}
