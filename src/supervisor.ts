import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ServerDef, ServerState, Status } from './types.js';

const GATEWAY_PORT_BASE = 9100;
const LOG_MAX = 500;
/** A line that means "the server is up" (supergateway or a self-hosted server). */
const READY_RE = /listening|running on|sse endpoint|server is running|started on|http:\/\//i;

interface Entry {
  def: ServerDef;
  state: ServerState;
  child?: ChildProcess;
  logs: string[];
  readyTimer?: NodeJS.Timeout;
  healthTimer?: NodeJS.Timeout;
}

/**
 * Owns the lifecycle of every server.
 *  - stdio: spawn the command (in its dir) wrapped by `supergateway`, exposed at
 *    http://localhost:<port>/sse.
 *  - http:  spawn the command (in its dir); it binds its own port. Health-check it.
 *  - remote: health-check the url only.
 * Emits 'status' (ServerState) and 'log' ({ id, line }).
 */
export class Supervisor extends EventEmitter {
  private entries = new Map<string, Entry>();
  private nextPort = GATEWAY_PORT_BASE;

  constructor(defs: ServerDef[]) {
    super();
    for (const def of defs) {
      this.entries.set(def.id, {
        def,
        logs: [],
        state: {
          id: def.id,
          name: def.name,
          source: def.source,
          transport: def.transport,
          status: 'stopped',
          dir: def.dir,
          port: def.transport === 'http' ? def.port : undefined,
          endpoint: def.transport === 'remote' ? def.url : undefined,
        },
      });
    }
  }

  list(): ServerState[] {
    return [...this.entries.values()].map((e) => e.state);
  }

  logs(id: string): string[] {
    return this.entries.get(id)?.logs ?? [];
  }

  async start(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e || e.child) return;
    if (e.def.transport === 'remote') return this.checkRemote(e);
    if (e.def.transport === 'http') return this.startHttp(e);
    return this.startStdio(e);
  }

  private startStdio(e: Entry): void {
    const port = e.state.port ?? this.nextPort++;
    e.state.port = port;
    e.state.endpoint = `http://localhost:${port}/sse`;

    const inner = [e.def.command!, ...(e.def.args ?? [])].map(quote).join(' ');
    const args = [
      '-y', 'supergateway',
      '--stdio', inner,
      '--port', String(port),
      '--ssePath', '/sse',
      '--messagePath', '/message',
    ];
    this.spawnProcess(e, 'npx', args, `npx ${args.map(quote).join(' ')}`);

    // No ready line? Assume healthy after a grace period.
    e.readyTimer = setTimeout(() => {
      if (e.child && e.state.status === 'starting') this.setStatus(e, 'running');
    }, 4000);
  }

  private startHttp(e: Entry): void {
    const port = e.def.port;
    e.state.port = port;
    e.state.endpoint = port ? `http://localhost:${port}${e.def.healthPath ?? ''}` : undefined;

    const display = `${e.def.command} ${(e.def.args ?? []).join(' ')}`;
    this.spawnProcess(e, e.def.command!, e.def.args ?? [], display);

    if (port) {
      // Health-check until the port answers.
      let tries = 0;
      e.healthTimer = setInterval(async () => {
        tries++;
        try {
          await fetch(`http://localhost:${port}${e.def.healthPath ?? '/'}`, {
            signal: AbortSignal.timeout(1500),
          });
          if (e.child && e.state.status === 'starting') this.setStatus(e, 'running');
          this.clearTimers(e);
        } catch {
          if (tries > 25) this.clearTimers(e);
        }
      }, 1000);
    } else {
      e.readyTimer = setTimeout(() => {
        if (e.child && e.state.status === 'starting') this.setStatus(e, 'running');
      }, 4000);
    }
  }

  private spawnProcess(e: Entry, command: string, args: string[], display: string): void {
    this.setStatus(e, 'starting');
    this.log(e, `$ ${e.def.dir ? `(cd ${e.def.dir}) ` : ''}${display}`);

    const child = spawn(command, args, {
      cwd: e.def.dir,
      env: { ...process.env, ...e.def.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    e.child = child;
    e.state.pid = child.pid;
    e.state.startedAt = Date.now();

    child.stdout?.on('data', (d: Buffer) => this.onData(e, d));
    child.stderr?.on('data', (d: Buffer) => this.onData(e, d));
    child.on('error', (err) => this.setStatus(e, 'error', err.message));
    child.on('exit', (code, signal) => {
      e.child = undefined;
      e.state.pid = undefined;
      this.clearTimers(e);
      if (e.state.status !== 'stopped') {
        this.setStatus(e, code === 0 ? 'stopped' : 'error', `exited (code=${code} signal=${signal})`);
      }
    });
  }

  async stop(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    this.setStatus(e, 'stopped');
    this.clearTimers(e);
    if (e.child) {
      e.child.kill('SIGTERM');
      e.child = undefined;
      e.state.pid = undefined;
    }
  }

  async restart(id: string): Promise<void> {
    await this.stop(id);
    await delay(300);
    await this.start(id);
  }

  async startAll(): Promise<void> {
    for (const id of this.entries.keys()) await this.start(id);
  }

  async stopAll(): Promise<void> {
    for (const id of this.entries.keys()) await this.stop(id);
  }

  private onData(e: Entry, d: Buffer): void {
    for (const line of d.toString('utf8').split('\n')) {
      this.log(e, line);
      if (e.state.status === 'starting' && READY_RE.test(line)) this.setStatus(e, 'running');
    }
  }

  private async checkRemote(e: Entry): Promise<void> {
    this.setStatus(e, 'starting');
    try {
      const res = await fetch(e.def.url!, { method: 'GET', signal: AbortSignal.timeout(5000) });
      this.log(e, `GET ${e.def.url} -> ${res.status}`);
      const up = res.ok || res.status === 400 || res.status === 405 || res.status === 406;
      this.setStatus(e, up ? 'running' : 'error', up ? undefined : `HTTP ${res.status}`);
    } catch (err) {
      this.setStatus(e, 'error', (err as Error)?.message ?? 'unreachable');
    }
  }

  private clearTimers(e: Entry): void {
    if (e.readyTimer) clearTimeout(e.readyTimer);
    if (e.healthTimer) clearInterval(e.healthTimer);
    e.readyTimer = undefined;
    e.healthTimer = undefined;
  }

  private setStatus(e: Entry, status: Status, err?: string): void {
    e.state.status = status;
    if (err) e.state.lastError = err;
    else if (status === 'running' || status === 'starting') e.state.lastError = undefined;
    this.emit('status', e.state);
  }

  private log(e: Entry, raw: string): void {
    const line = raw.replace(/\s+$/, '');
    if (!line) return;
    e.logs.push(line);
    if (e.logs.length > LOG_MAX) e.logs.shift();
    this.emit('log', { id: e.def.id, line });
  }
}

function quote(s: string): string {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
