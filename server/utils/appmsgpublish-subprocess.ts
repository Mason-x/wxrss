import { spawn } from 'node:child_process';
import { USER_AGENT } from '~/config';
import { logMemory } from '~/server/utils/memory-debug';

export interface AppmsgPublishSubprocessResult {
  base_resp: {
    ret: number;
    err_msg?: string;
  };
  articles?: Record<string, any>[];
  total_count?: number;
  page_message_count?: number;
  completed?: boolean;
}

interface AppmsgPublishSubprocessInput {
  endpoint: string;
  query: Record<string, string | number>;
  cookie: string;
  timeoutMs?: number;
}

const APPMSGPUBLISH_CHILD_SOURCE = String.raw`
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

function compactArticlePayload(article) {
  return {
    aid: String(article && article.aid || ''),
    appmsgid: Number(article && article.appmsgid) || 0,
    itemidx: Number(article && article.itemidx) || 0,
    link: String(article && article.link || ''),
    title: String(article && article.title || ''),
    digest: String(article && article.digest || ''),
    author_name: String(article && article.author_name || ''),
    cover: String(article && article.cover || ''),
    create_time: Number(article && article.create_time) || 0,
    update_time: Number(article && article.update_time) || 0,
    item_show_type: Number(article && article.item_show_type) || 0,
    media_duration: String(article && article.media_duration || ''),
    appmsg_album_infos: Array.isArray(article && article.appmsg_album_infos) ? article.appmsg_album_infos : [],
    copyright_stat: Number(article && article.copyright_stat) || 0,
    copyright_type: Number(article && article.copyright_type) || 0,
    is_deleted: Boolean(article && article.is_deleted),
    _status: String(article && article._status || ''),
  };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      input += String(chunk || '');
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function getHeaderValue(headers, name) {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value || '');
}

async function readJson(payload) {
  return await new Promise((resolve, reject) => {
    const url = new URL(payload.endpoint);
    if (payload.query) {
      url.search = new URLSearchParams(payload.query).toString();
    }

    const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestImpl({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Referer: 'https://mp.weixin.qq.com/',
        Origin: 'https://mp.weixin.qq.com',
        'User-Agent': payload.userAgent,
        'Accept-Encoding': 'identity',
        Connection: 'close',
        Cookie: payload.cookie || '',
      },
      agent: false,
    }, response => {
      const status = Number(response.statusCode || 0);
      const contentLength = Number(getHeaderValue(response.headers, 'content-length') || 0);
      if (Number.isFinite(contentLength) && contentLength > payload.maxJsonBytes) {
        response.resume();
        reject(new Error('mp response too large(status=' + status + ', content-length=' + contentLength + ', limit=' + payload.maxJsonBytes + ')'));
        return;
      }

      response.setEncoding('utf8');
      let text = '';
      let bytes = 0;
      let settled = false;

      const fail = error => {
        if (settled) {
          return;
        }
        settled = true;
        response.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      response.on('data', chunk => {
        const chunkText = String(chunk || '');
        bytes += Buffer.byteLength(chunkText, 'utf8');
        if (bytes > payload.maxJsonBytes) {
          fail(new Error('mp response too large(status=' + status + ', bytes=' + bytes + ', limit=' + payload.maxJsonBytes + ')'));
          return;
        }
        text += chunkText;
      });

      response.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          resolve(JSON.parse(text || '{}'));
        } catch {
          reject(new Error('mp response is not json(status=' + status + '): ' + String(text || '').slice(0, 220)));
        }
      });

      response.on('error', fail);
    });

    req.on('error', error => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    req.setTimeout(payload.timeoutMs, () => {
      req.destroy(new Error('mp request timeout(timeoutMs=' + payload.timeoutMs + ')'));
    });
    req.end();
  });
}

function normalizeAppmsgpublishResponse(resp) {
  if (!resp || !resp.base_resp) {
    return {
      base_resp: {
        ret: -1,
        err_msg: 'invalid appmsgpublish response',
      },
    };
  }

  if (Number(resp.base_resp.ret) !== 0) {
    return resp;
  }

  const publishPage = JSON.parse(String(resp.publish_page || '{}'));
  const publishList = Array.isArray(publishPage.publish_list) ? publishPage.publish_list : [];
  const articles = [];
  let pageMessageCount = 0;

  for (const item of publishList) {
    if (!item || !item.publish_info) {
      continue;
    }
    pageMessageCount += 1;
    try {
      const publishInfo = JSON.parse(String(item.publish_info || '{}'));
      const appmsgList = Array.isArray(publishInfo.appmsgex) ? publishInfo.appmsgex : [];
      for (const article of appmsgList) {
        articles.push(compactArticlePayload(article));
      }
    } catch {}
  }

  return {
    base_resp: resp.base_resp,
    articles,
    total_count: Number(publishPage.total_count) || 0,
    page_message_count: pageMessageCount,
    completed: pageMessageCount === 0,
  };
}

try {
  const raw = await readStdin();
  const payload = JSON.parse(String(raw || '{}'));
  const response = await readJson(payload);
  const result = normalizeAppmsgpublishResponse(response);
  process.stdout.write(JSON.stringify({ ok: true, value: result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message || error || 'unknown error') }));
  process.exitCode = 1;
}
`;

function toMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function getSoftHeapLimitMb(): number | null {
  const configured = Number(process.env.MP_PROXY_SOFT_HEAP_MB || 3000);
  if (!Number.isFinite(configured) || configured <= 0) {
    return null;
  }
  return Math.floor(configured);
}

function getChildMaxOldSpaceMb(): number {
  const configured = Number(process.env.MP_APPMESSAGE_CHILD_MAX_OLD_SPACE_MB || 256);
  if (!Number.isFinite(configured) || configured <= 0) {
    return 256;
  }
  return Math.floor(configured);
}

function getMaxJsonBytes(): number {
  return Math.max(1024 * 1024, Number(process.env.MP_PROXY_MAX_JSON_BYTES || 8 * 1024 * 1024));
}

function assertMainHeapAvailable(endpoint: string): void {
  const limitMb = getSoftHeapLimitMb();
  if (!limitMb) {
    return;
  }

  const heapUsedMb = toMb(process.memoryUsage().heapUsed);
  if (heapUsedMb < limitMb) {
    return;
  }

  logMemory('appmsgpublish:memory-pressure-before-subprocess', {
    endpoint,
    heapUsedMb,
    limitMb,
  });
  throw new Error(`mp proxy aborted due to heap pressure(heapUsedMb=${heapUsedMb}, limitMb=${limitMb})`);
}

export async function requestAppmsgpublishInSubprocess(
  input: AppmsgPublishSubprocessInput
): Promise<AppmsgPublishSubprocessResult> {
  assertMainHeapAvailable(input.endpoint);

  const timeoutMs = Math.max(1000, Number(input.timeoutMs || process.env.MP_REQUEST_TIMEOUT_MS || 30000));
  const childMaxOldSpaceMb = getChildMaxOldSpaceMb();
  logMemory('appmsgpublish:subprocess-start', {
    endpoint: input.endpoint,
    timeoutMs,
    childMaxOldSpaceMb,
  });
  const payload = {
    endpoint: input.endpoint,
    query: input.query,
    cookie: input.cookie,
    timeoutMs,
    maxJsonBytes: getMaxJsonBytes(),
    userAgent: USER_AGENT,
  };

  return await new Promise((resolve, reject) => {
    let stdoutText = '';
    let stderrText = '';
    let settled = false;

    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${childMaxOldSpaceMb}`,
        '--input-type=module',
        '--eval',
        APPMSGPUBLISH_CHILD_SOURCE,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    const finish = (error: Error | null, value?: AppmsgPublishSubprocessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve(value as AppmsgPublishSubprocessResult);
    };

    const killTimer = setTimeout(() => {
      child.kill();
      finish(new Error(`mp subprocess timeout(timeoutMs=${timeoutMs})`));
    }, timeoutMs + 1000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdoutText += String(chunk || '');
    });
    child.stderr.on('data', chunk => {
      stderrText += String(chunk || '');
    });
    child.on('error', error => {
      clearTimeout(killTimer);
      logMemory('appmsgpublish:subprocess-error', {
        endpoint: input.endpoint,
        message: String(error instanceof Error ? error.message : error),
      });
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    child.on('close', code => {
      clearTimeout(killTimer);
      stdoutText = stdoutText.trim();
      stderrText = stderrText.trim();
      logMemory('appmsgpublish:subprocess-close', {
        endpoint: input.endpoint,
        code: code ?? -1,
        stdoutBytes: Buffer.byteLength(stdoutText, 'utf8'),
        stderrBytes: Buffer.byteLength(stderrText, 'utf8'),
      });

      if (!stdoutText) {
        finish(new Error(stderrText || `mp subprocess exited unexpectedly(code=${code ?? -1})`));
        return;
      }

      try {
        const parsed = JSON.parse(stdoutText) as {
          ok: boolean;
          value?: AppmsgPublishSubprocessResult;
          error?: string;
        };
        if (!parsed.ok || !parsed.value) {
          finish(new Error(String(parsed.error || stderrText || `mp subprocess failed(code=${code ?? -1})`)));
          return;
        }
        finish(null, parsed.value);
      } catch {
        finish(new Error(stderrText || `mp subprocess returned invalid payload(code=${code ?? -1})`));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
