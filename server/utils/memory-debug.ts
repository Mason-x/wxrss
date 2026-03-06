import fs from 'node:fs';
import path from 'node:path';

interface MemoryDebugFields {
  [key: string]: unknown;
}

function toMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function getMemoryLogFilePath(): string {
  const customPath = String(process.env.NUXT_DEBUG_MEMORY_FILE || '').trim();
  if (customPath) {
    return path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath);
  }
  return path.resolve(process.cwd(), '.data', 'logs', `memory-debug-${process.pid}.ndjson`);
}

function shouldPrintMemoryDebugToConsole(): boolean {
  return process.env.NUXT_DEBUG_MEMORY_CONSOLE === 'true';
}

function getMemoryLogMaxBytes(): number {
  const max = Number(process.env.NUXT_DEBUG_MEMORY_MAX_FILE_BYTES || 50 * 1024 * 1024);
  if (!Number.isFinite(max) || max <= 0) {
    return 50 * 1024 * 1024;
  }
  return Math.floor(max);
}

let initialized = false;
let writeGuard = false;

function ensureMemoryLogFileReady(logFilePath: string): void {
  if (initialized) {
    return;
  }
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '', 'utf8');
  }
  initialized = true;
}

function rotateMemoryLogIfNeeded(logFilePath: string, maxBytes: number): void {
  try {
    const stat = fs.statSync(logFilePath);
    if (stat.size < maxBytes) {
      return;
    }
    const rotated = `${logFilePath}.${Date.now()}`;
    fs.renameSync(logFilePath, rotated);
    fs.writeFileSync(logFilePath, '', 'utf8');
  } catch {
    // Ignore rotation failures and keep writing to current file.
  }
}

function appendMemoryLogLine(payload: Record<string, unknown>): void {
  const logFilePath = getMemoryLogFilePath();
  const maxBytes = getMemoryLogMaxBytes();
  ensureMemoryLogFileReady(logFilePath);
  rotateMemoryLogIfNeeded(logFilePath, maxBytes);
  fs.appendFileSync(logFilePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export function isMemoryDebugEnabled(): boolean {
  return process.env.NUXT_DEBUG_MEMORY === 'true';
}

export function logMemory(stage: string, fields: MemoryDebugFields = {}): void {
  if (!isMemoryDebugEnabled()) {
    return;
  }
  if (writeGuard) {
    return;
  }

  const usage = process.memoryUsage();
  const payload = {
    t: new Date().toISOString(),
    stage,
    pid: process.pid,
    rssMb: toMb(usage.rss),
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    externalMb: toMb(usage.external),
    arrayBuffersMb: toMb(usage.arrayBuffers),
    ...fields,
  };

  writeGuard = true;
  try {
    appendMemoryLogLine(payload);
    // Console logging is opt-in because dev log retention can amplify memory pressure.
    if (shouldPrintMemoryDebugToConsole()) {
      console.log(`[mem-debug] ${JSON.stringify(payload)}`);
    }
  } catch {
    // Avoid recursive logging on write failures.
  } finally {
    writeGuard = false;
  }
}
