import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveChildScriptDir(): string {
  const serverDir = path.resolve(process.cwd(), 'server');
  if (fs.existsSync(serverDir)) {
    return path.join(serverDir, 'runtime-child-scripts');
  }

  return path.join(os.tmpdir(), 'wxrss-child-scripts');
}

export function ensureRuntimeChildScript(filename: string, source: string): string {
  const childScriptDir = resolveChildScriptDir();
  fs.mkdirSync(childScriptDir, { recursive: true });

  const scriptPath = path.join(childScriptDir, filename);
  const current = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  if (current !== source) {
    fs.writeFileSync(scriptPath, source, 'utf8');
  }

  return scriptPath;
}
