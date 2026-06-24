import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { Supervisor } from './supervisor.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(__dirname, '..', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Start the control HTTP+WS server: REST API under /api, live events on /ws, dashboard static files. */
export function createControlServer(sup: Supervisor, port: number) {
  const server = createServer(async (req, res) => {
    cors(res);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url.pathname, sup);
      } else {
        await serveStatic(url.pathname, res);
      }
    } catch (err) {
      sendJson(res, 500, { error: (err as Error)?.message ?? 'internal error' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'snapshot', servers: sup.list() }));
  });
  const broadcast = (msg: unknown) => {
    const s = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(s);
  };
  sup.on('status', (state) => broadcast({ type: 'status', state }));
  sup.on('log', (e) => broadcast({ type: 'log', ...e }));

  server.listen(port);
  return server;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  sup: Supervisor,
): Promise<void> {
  if (path === '/api/health') return sendJson(res, 200, { ok: true });
  if (path === '/api/servers' && req.method === 'GET') {
    return sendJson(res, 200, { servers: sup.list() });
  }
  if (path === '/api/up' && req.method === 'POST') {
    await sup.startAll();
    return sendJson(res, 200, { ok: true });
  }
  if (path === '/api/down' && req.method === 'POST') {
    await sup.stopAll();
    return sendJson(res, 200, { ok: true });
  }

  const m = path.match(/^\/api\/servers\/([^/]+)\/(start|stop|restart|logs)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const action = m[2];
    if (action === 'logs') return sendJson(res, 200, { logs: sup.logs(id) });
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
    if (action === 'start') await sup.start(id);
    if (action === 'stop') await sup.stop(id);
    if (action === 'restart') await sup.restart(id);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'not found' });
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  if (!existsSync(WEB_DIR)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PLACEHOLDER_HTML);
    return;
  }
  // SPA: map unknown routes back to index.html.
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !existsSync(file)) file = join(WEB_DIR, 'index.html');
  const body = await readFile(file);
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(body);
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const PLACEHOLDER_HTML = `<!doctype html><meta charset="utf-8"><title>mcp-station</title>
<body style="font:16px system-ui;max-width:640px;margin:80px auto;padding:0 20px;color:#222">
<h1>mcp-station daemon is running ✅</h1>
<p>The dashboard UI has not been built yet. Run:</p>
<pre style="background:#f4f4f5;padding:12px;border-radius:8px">npm run build:web</pre>
<p>API is live: <a href="/api/servers">/api/servers</a></p>
</body>`;
