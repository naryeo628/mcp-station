<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

type Status = 'stopped' | 'starting' | 'running' | 'error';
interface ServerState {
  id: string;
  name: string;
  source: string;
  transport: 'stdio' | 'http' | 'remote';
  status: Status;
  pid?: number;
  dir?: string;
  port?: number;
  endpoint?: string;
  startedAt?: number;
  lastError?: string;
}

const mode = ref<'connecting' | 'live' | 'demo'>('connecting');
const servers = ref<ServerState[]>([]);
const logs = reactive<Record<string, string[]>>({});
const openLog = ref<string | null>(null);
const copied = ref<string | null>(null);
let ws: WebSocket | null = null;

const API = ''; // same-origin: the daemon serves this page

const DEMO: ServerState[] = [
  { id: 'project:my-ts-mcp', name: 'my-ts-mcp', source: 'project', transport: 'stdio', status: 'running', pid: 51220, port: 9100, dir: '~/work/mcp/ts-svc', endpoint: 'http://localhost:9100/sse' },
  { id: 'project:my-py-mcp', name: 'my-py-mcp', source: 'project', transport: 'http', status: 'running', pid: 51221, port: 8000, dir: '~/work/mcp/py-svc', endpoint: 'http://localhost:8000' },
  { id: 'project:crawler-mcp', name: 'crawler-mcp', source: 'project', transport: 'stdio', status: 'error', port: 9101, dir: '~/work/mcp/crawler', endpoint: 'http://localhost:9101/sse', lastError: 'exited (code=1) — module not found, run `uv sync`' },
  { id: 'project:notes-mcp', name: 'notes-mcp', source: 'project', transport: 'http', status: 'stopped', port: 8010, dir: '~/work/mcp/notes' },
  { id: 'cursor:figma', name: 'Figma', source: 'cursor', transport: 'remote', status: 'running', endpoint: 'https://mcp.figma.com/mcp' },
  { id: 'cursor:playwright', name: 'playwright', source: 'cursor', transport: 'stdio', status: 'starting', port: 9102, endpoint: 'http://localhost:9102/sse' },
];

const counts = computed(() => {
  const c = { running: 0, error: 0, total: servers.value.length };
  for (const s of servers.value) {
    if (s.status === 'running') c.running++;
    if (s.status === 'error') c.error++;
  }
  return c;
});

function upsert(state: ServerState) {
  const i = servers.value.findIndex((s) => s.id === state.id);
  if (i >= 0) servers.value[i] = state;
  else servers.value.push(state);
}

async function probe() {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error();
    const data = await fetch(`${API}/api/servers`).then((r) => r.json());
    servers.value = data.servers;
    mode.value = 'live';
    connectWs();
  } catch {
    mode.value = 'demo';
    servers.value = DEMO;
  }
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') servers.value = msg.servers;
    else if (msg.type === 'status') upsert(msg.state);
    else if (msg.type === 'log') {
      (logs[msg.id] ??= []).push(msg.line);
      if (logs[msg.id].length > 500) logs[msg.id].shift();
    }
  };
  ws.onclose = () => setTimeout(() => mode.value === 'live' && connectWs(), 2000);
}

async function act(id: string, action: 'start' | 'stop' | 'restart') {
  if (mode.value !== 'live') return;
  await fetch(`${API}/api/servers/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
}
async function all(action: 'up' | 'down') {
  if (mode.value !== 'live') return;
  await fetch(`${API}/api/${action}`, { method: 'POST' });
}

async function toggleLog(id: string) {
  if (openLog.value === id) { openLog.value = null; return; }
  openLog.value = id;
  if (mode.value === 'live' && !logs[id]) {
    const data = await fetch(`${API}/api/servers/${encodeURIComponent(id)}/logs`).then((r) => r.json());
    logs[id] = data.logs ?? [];
  }
}

function copyEndpoint(s: ServerState) {
  if (!s.endpoint) return;
  navigator.clipboard?.writeText(s.endpoint);
  copied.value = s.id;
  setTimeout(() => (copied.value = null), 1200);
}

const dotClass = (s: Status) =>
  ({ running: 'd-green', starting: 'd-amber', error: 'd-red', stopped: 'd-gray' })[s];

onMounted(probe);
onUnmounted(() => ws?.close());
</script>

<template>
  <header class="bar">
    <div class="brand">
      <span class="logo">⚡</span>
      <h1>mcp-station</h1>
      <span class="tag" :class="mode">{{ mode === 'live' ? 'LIVE' : mode === 'demo' ? 'DEMO' : '…' }}</span>
    </div>
    <div class="summary">
      <span class="pill"><b>{{ counts.running }}</b>/{{ counts.total }} running</span>
      <span v-if="counts.error" class="pill err"><b>{{ counts.error }}</b> error</span>
      <button :disabled="mode !== 'live'" @click="all('up')">▶ Start all</button>
      <button :disabled="mode !== 'live'" @click="all('down')">■ Stop all</button>
    </div>
  </header>

  <div v-if="mode === 'demo'" class="banner">
    Demo data — no daemon connected. Run
    <code>npx mcp-station up</code>
    then open <code>http://localhost:4040</code> to control your real servers.
  </div>

  <main class="grid">
    <section v-for="s in servers" :key="s.id" class="card">
      <div class="row">
        <span class="dot" :class="dotClass(s.status)" :title="s.status"></span>
        <span class="name">{{ s.name }}</span>
        <span class="badge" :class="s.transport">{{ s.transport }}</span>
        <span class="src">{{ s.source }}</span>
      </div>

      <div v-if="s.dir" class="dir" :title="s.dir">📁 {{ s.dir }}</div>

      <div class="meta">
        <template v-if="s.endpoint">
          <code class="endpoint" :title="s.endpoint">{{ s.endpoint }}</code>
          <button class="mini" @click="copyEndpoint(s)">{{ copied === s.id ? '✓' : 'copy' }}</button>
        </template>
        <span v-else class="muted">no endpoint</span>
      </div>

      <div v-if="s.lastError" class="error">{{ s.lastError }}</div>

      <div class="actions">
        <button class="mini" :disabled="mode !== 'live' || s.transport === 'remote'" @click="act(s.id, 'start')">start</button>
        <button class="mini" :disabled="mode !== 'live' || s.transport === 'remote'" @click="act(s.id, 'stop')">stop</button>
        <button class="mini" :disabled="mode !== 'live'" @click="act(s.id, 'restart')">restart</button>
        <button class="mini ghost" @click="toggleLog(s.id)">{{ openLog === s.id ? 'hide logs' : 'logs' }}</button>
      </div>

      <pre v-if="openLog === s.id" class="logs">{{ (logs[s.id] ?? []).join('\n') || '(no output yet)' }}</pre>
    </section>
  </main>

  <footer class="foot">
    stdio servers are wrapped by a local SSE gateway · remote servers are health-checked only
  </footer>
</template>

<style scoped>
.bar {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 12px;
  padding: 16px 24px; border-bottom: 1px solid var(--border);
  position: sticky; top: 0; background: var(--bg); z-index: 10;
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo { font-size: 22px; }
h1 { font-size: 19px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
.tag { font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 6px; letter-spacing: 0.05em; }
.tag.live { background: rgba(63,207,142,0.15); color: var(--green); }
.tag.demo { background: rgba(255,194,75,0.15); color: var(--amber); }
.tag.connecting { background: var(--panel-2); color: var(--muted); }
.summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pill { font-size: 13px; color: var(--muted); background: var(--panel); border: 1px solid var(--border); padding: 4px 10px; border-radius: 8px; }
.pill b { color: var(--text); }
.pill.err b { color: var(--red); }

.banner { margin: 16px 24px 0; padding: 12px 16px; background: rgba(255,194,75,0.08); border: 1px solid rgba(255,194,75,0.3); border-radius: 10px; font-size: 13px; color: var(--amber); }
.banner code { background: rgba(0,0,0,0.35); padding: 2px 6px; border-radius: 5px; color: var(--text); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; padding: 20px 24px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.row { display: flex; align-items: center; gap: 9px; }
.name { font-weight: 600; font-size: 15px; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.d-green { background: var(--green); box-shadow: 0 0 8px var(--green); }
.d-amber { background: var(--amber); animation: pulse 1s infinite; }
.d-red { background: var(--red); }
.d-gray { background: var(--gray); }
@keyframes pulse { 50% { opacity: 0.35; } }
.badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 5px; font-weight: 700; }
.badge.stdio { background: rgba(109,139,255,0.15); color: var(--accent); }
.badge.http { background: rgba(63,207,142,0.15); color: var(--green); }
.badge.remote { background: rgba(139,145,163,0.15); color: var(--muted); }
.src { margin-left: auto; font-size: 12px; color: var(--muted); }
.dir { margin-top: 7px; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.meta { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.endpoint { font-size: 12px; color: var(--muted); background: var(--panel-2); padding: 4px 8px; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.muted { color: var(--muted); font-size: 12px; }
.error { margin-top: 8px; font-size: 12px; color: var(--red); background: rgba(255,93,108,0.08); padding: 6px 8px; border-radius: 6px; }

.actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
.mini { padding: 4px 10px; font-size: 12px; border-radius: 6px; }
.ghost { background: transparent; }

.logs { margin-top: 10px; background: #0a0c11; border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-size: 11.5px; line-height: 1.45; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; color: #b8bdca; }

.foot { text-align: center; padding: 24px; color: var(--muted); font-size: 12px; }
</style>
