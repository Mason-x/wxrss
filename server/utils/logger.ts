import fs from 'node:fs';
import path from 'node:path';

function getRequestLogFilePath(): string {
  const customPath = String(process.env.NUXT_DEBUG_MP_REQUEST_FILE || '').trim();
  if (customPath) {
    return path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath);
  }
  return path.resolve(process.cwd(), '.data', 'logs', 'request.log');
}

function logToFile(prefix: string, message: string) {
  const logFilePath = getRequestLogFilePath();
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const logEntry = `[${prefix} ${timestamp}]\n${message}\n\n\n`;
  fs.appendFileSync(logFilePath, logEntry, 'utf8');
}

export async function logRequest(requestId: string, request: Request) {
  let requestBody = '<nil>';
  if (request.body) {
    requestBody = await request.text();
  }

  const requestLog = `Request-ID: ${requestId}
${request.method} ${request.url} HTTP/1.1
Host: ${new URL(request.url).host}
${[...request.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n')}

${requestBody}`;
  logToFile('request', requestLog);
}

export async function logResponse(requestId: string, response: Response) {
  let responseBody = '';
  if (response.headers.get('Content-Type') === 'application/json') {
    responseBody = JSON.stringify(await response.json(), null, 2);
  } else {
    responseBody = await response.text();
  }
  responseBody = responseBody.length > 200 ? `${responseBody.slice(0, 200)}...` : responseBody;

  const responseLog = `Request-ID: ${requestId}
HTTP/1.1 ${response.status} ${response.statusText}
${Array.from(response.headers.entries())
  .map(([key, value]) => `${key}: ${value}`)
  .join('\n')}
${responseBody ? `\n${responseBody}` : '\n<nil>'}`;
  logToFile('response', responseLog);
}
