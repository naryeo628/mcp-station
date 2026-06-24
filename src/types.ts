/**
 * stdio   — spawned via command/args, talks over stdin/stdout; wrapped by a
 *           local SSE gateway so clients can connect by URL.
 * http    — spawned via command/args; the process binds its own port (a
 *           self-hosted HTTP/SSE MCP server). Run + health-check the port.
 * remote  — already hosted elsewhere; only health-checked, never spawned.
 */
export type Transport = 'stdio' | 'http' | 'remote';
export type Status = 'stopped' | 'starting' | 'running' | 'error';

/** A normalized MCP server definition (from a project manifest or a client config). */
export interface ServerDef {
  /** Stable id: `${source}:${slug(name)}`. */
  id: string;
  name: string;
  /** project (manifest) | cursor | claude-code | claude-desktop | vscode | custom:<path>. */
  source: string;
  transport: Transport;
  // stdio / http transports
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Working directory the command runs in (your project folder). */
  dir?: string;
  /** http: the port the project listens on. (stdio assigns a gateway port automatically.) */
  port?: number;
  /** http: path to health-check, default '/'. */
  healthPath?: string;
  // remote transport
  url?: string;
}

/** Live runtime state for a server, sent to the dashboard. */
export interface ServerState {
  id: string;
  name: string;
  source: string;
  transport: Transport;
  status: Status;
  pid?: number;
  /** Working directory the process runs in. */
  dir?: string;
  /** Gateway port (stdio) or the project's own port (http). */
  port?: number;
  /** URL a client connects to: gateway SSE endpoint (stdio) or the remote url. */
  endpoint?: string;
  startedAt?: number;
  lastError?: string;
}
