import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.json";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isFirefox = process.env.BROWSER === "firefox";

export default defineConfig({
  plugins: [
    react(),
    crx({
      manifest: manifest as unknown as Parameters<typeof crx>[0]["manifest"],
      browser: isFirefox ? ("firefox" as const) : ("chrome" as const),
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  publicDir: false,
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 },
  },
});
