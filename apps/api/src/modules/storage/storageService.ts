import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

export function getStorageStats() {
  const root = config.dataDir;
  let used = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile()) used += fs.statSync(fullPath).size;
    }
  }

  const disk = fs.statfsSync(root);
  return {
    used,
    available: disk.bavail * disk.bsize,
    total: disk.blocks * disk.bsize,
    dataDir: root
  };
}
