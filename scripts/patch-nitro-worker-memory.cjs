const fs = require('node:fs');
const path = require('node:path');

const nitroCoreFile = path.join(process.cwd(), 'node_modules', 'nitropack', 'dist', 'core', 'index.mjs');

if (!fs.existsSync(nitroCoreFile)) {
  console.log(`[patch] skip: file not found ${nitroCoreFile}`);
  process.exit(0);
}

const source = fs.readFileSync(nitroCoreFile, 'utf8');
const execArgvPattern = /execArgv:\s*\[\s*['"]--max-old-space-size=4096['"]\s*\],?/;

if (!execArgvPattern.test(source)) {
  console.log('[patch] nitropack worker memory patch already applied or not needed');
  process.exit(0);
}

const patched = source.replace(execArgvPattern, 'resourceLimits: { maxOldGenerationSizeMb: 4096 },');

fs.writeFileSync(nitroCoreFile, patched, 'utf8');
console.log('[patch] nitropack worker memory patch applied');
