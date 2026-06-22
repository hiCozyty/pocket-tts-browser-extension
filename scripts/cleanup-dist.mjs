import { readdirSync, statSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, "..", "dist");

const removeDir = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      removeDir(p);
    } else {
      unlinkSync(p);
    }
  }
  rmdirSync(dir);
  console.log(`removed dist/${relative(dist, dir)}/`);
};

for (const name of ["wasm", "icons"]) {
  const target = resolve(dist, name);
  if (existsSync(target) && statSync(target).isDirectory()) {
    removeDir(target);
  }
}
