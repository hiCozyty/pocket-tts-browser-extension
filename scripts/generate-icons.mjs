#!/usr/bin/env node
// Generates simple PNG icons (16, 32, 48, 128) for the extension.
// Uses the `pngjs` package — install it with `npm install --save-dev pngjs`.
// Run with: node scripts/generate-icons.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const drawIcon = (size) => {
  const png = new PNG({ width: size, height: size });

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) << 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        const t = dist / r;
        const r0 = Math.round(139 * (1 - t) + 236 * t);
        const g0 = Math.round(92 * (1 - t) + 72 * t);
        const b0 = Math.round(246 * (1 - t) + 153 * t);
        const a = dist > r - 1 ? Math.max(0, 1 - (dist - (r - 1))) : 1;
        png.data[idx] = r0;
        png.data[idx + 1] = g0;
        png.data[idx + 2] = b0;
        png.data[idx + 3] = Math.round(255 * a);
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      }
    }
  }

  const strokeW = Math.max(1, size * 0.12);
  const capTop = size * 0.32;
  const capBottom = size * 0.78;
  const stemLeft = size * 0.32;
  const stemRight = size * 0.68;
  const capHeight = size * 0.16;

  for (let y = capTop; y < capTop + capHeight; y++) {
    for (let x = stemLeft; x < stemRight; x++) {
      const idx = (Math.floor(y) * size + Math.floor(x)) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 230;
    }
  }

  const stemW = (stemRight - stemLeft) * 0.32;
  const stemX = (stemLeft + stemRight) / 2 - stemW / 2;
  for (let y = capTop; y < capBottom; y++) {
    for (let x = stemX; x < stemX + stemW; x++) {
      const idx = (Math.floor(y) * size + Math.floor(x)) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 230;
    }
  }

  for (const s of [16, 32, 48, 128]) {
    const buf = PNG.sync.write(png);
    writeFileSync(join(outDir, `icon-${s}.png`), buf);
  }
};

for (const s of [16, 32, 48, 128]) {
  const png = new PNG({ width: s, height: s });
  const cx = s / 2;
  const cy = s / 2;
  const r = s / 2 - 0.5;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = (y * s + x) << 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) {
        const t = dist / r;
        const r0 = Math.round(139 * (1 - t) + 236 * t);
        const g0 = Math.round(92 * (1 - t) + 72 * t);
        const b0 = Math.round(246 * (1 - t) + 153 * t);
        png.data[idx] = r0;
        png.data[idx + 1] = g0;
        png.data[idx + 2] = b0;
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      }
    }
  }

  const strokeW = Math.max(1, s * 0.12);
  const capTop = Math.floor(s * 0.30);
  const capBottom = Math.floor(s * 0.80);
  const stemLeft = Math.floor(s * 0.30);
  const stemRight = Math.floor(s * 0.70);
  const capHeight = Math.max(1, Math.floor(s * 0.14));

  for (let y = capTop; y < capTop + capHeight; y++) {
    for (let x = stemLeft; x < stemRight; x++) {
      const idx = (y * s + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 240;
    }
  }

  const stemW = Math.max(1, Math.floor((stemRight - stemLeft) * 0.32));
  const stemX = Math.floor((stemLeft + stemRight) / 2 - stemW / 2);
  for (let y = capTop; y < capBottom; y++) {
    for (let x = stemX; x < stemX + stemW; x++) {
      const idx = (y * s + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 240;
    }
  }

  const buf = PNG.sync.write(png);
  writeFileSync(join(outDir, `icon-${s}.png`), buf);
  }

void drawIcon;
