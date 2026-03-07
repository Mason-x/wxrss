import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHILD_SCRIPT_DIR = path.join(os.tmpdir(), 'wxrss-child-scripts');

export function ensureRuntimeChildScript(filename: string, source: string): string {
  fs.mkdirSync(CHILD_SCRIPT_DIR, { recursive: true });

  const scriptPath = path.join(CHILD_SCRIPT_DIR, filename);
  const current = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  if (current !== source) {
    fs.writeFileSync(scriptPath, source, 'utf8');
  }

  return scriptPath;
}
