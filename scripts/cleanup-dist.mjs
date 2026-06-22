import {
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
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
  };

for (const name of ["wasm", "icons"]) {
  const target = resolve(dist, name);
  if (existsSync(target) && statSync(target).isDirectory()) {
    removeDir(target);
  }
}

const assetsDir = resolve(dist, "assets");
if (existsSync(assetsDir)) {
  const workerFiles = readdirSync(assetsDir).filter(
    (f) => f.startsWith("wasm-tts.worker-") && f.endsWith(".ts"),
  );
  for (const oldName of workerFiles) {
    const newName = oldName.replace(/\.ts$/, ".js");
    const oldPath = resolve(assetsDir, oldName);
    const newPath = resolve(assetsDir, newName);
    renameSync(oldPath, newPath);
    
    for (const ref of readdirSync(assetsDir)) {
      if (!ref.endsWith(".js") && !ref.endsWith(".ts")) continue;
      const refPath = resolve(assetsDir, ref);
      const content = readFileSync(refPath, "utf8");
      if (!content.includes(oldName)) continue;
      const updated = content.split(oldName).join(newName);
      writeFileSync(refPath, updated, "utf8");
          }
  }
}
