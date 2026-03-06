const fs = require('node:fs');
const path = require('node:path');

const viteCacheDir = path.join(process.cwd(), 'node_modules', '.cache', 'vite');

try {
  fs.rmSync(viteCacheDir, { recursive: true, force: true });
  console.log(`[cache] cleared ${viteCacheDir}`);
} catch (error) {
  console.warn(`[cache] failed to clear ${viteCacheDir}:`, error?.message || error);
}
