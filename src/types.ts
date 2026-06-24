export type Transport = 'stdio' | 'remote';
export type Status = 'stopped' | 'starting' | 'running' | 'error';

/** A normalized MCP server definition discovered from a client config. */
export interface ServerDef {
  /** Stable id: `${source}:${slug(name)}`. */
  id: string;
  name: string;
  /** Where it was discovered: cursor | claude-code | claude-desktop | vscode | custom:<path>. */
  source: string;
  transport: Transport;
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
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
  /** Local gateway port (stdio only). */
  port?: number;
  /** URL a client connects to: gateway SSE endpoint (stdio) or the remote url. */
  endpoint?: string;
  startedAt?: number;
  lastError?: string;
}
