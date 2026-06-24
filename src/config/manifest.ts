import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerDef, Transport } from '../types.js';

/** Expand a leading `~` to the home directory. */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export interface ManifestResult {
  defs: ServerDef[];
  path?: string;
  /** Whether to also pull servers from client configs (Cursor/Claude/…). Default true. */
  includeClientConfigs: boolean;
}

/** Candidate manifest locations, highest priority first. */
function manifestPaths(): string[] {
  const out: string[] = [];
  if (process.env.MCP_STATION_MANIFEST) out.push(process.env.MCP_STATION_MANIFEST);
  out.push(join(process.cwd(), 'mcp-station.json'));
  out.push(join(homedir(), '.mcp-station', 'projects.json'));
  return out;
}

/** Load the first manifest found, normalizing its `projects[]` into ServerDef[]. */
export async function loadManifest(): Promise<ManifestResult> {
  for (const p of manifestPaths()) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(await readFile(p, 'utf8'));
      const projects: unknown[] = Array.isArray(j.projects) ? j.projects : [];
      const defs: ServerDef[] = [];
      for (const x of projects) {
        const d = toDef(x);
        if (d) defs.push(d);
      }
      return { defs, path: p, includeClientConfigs: j.includeClientConfigs !== false };
    } catch {
      // bad JSON — try the next candidate
    }
  }
  return { defs: [], includeClientConfigs: true };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toDef(x: any): ServerDef | null {
  if (!x || typeof x !== 'object' || typeof x.name !== 'string') return null;
  const transport: Transport =
    x.transport === 'http' ? 'http' : x.transport === 'remote' ? 'remote' : 'stdio';
  const id = `project:${slug(x.name)}`;

  if (transport === 'remote') {
    if (typeof x.url !== 'string') return null;
    return { id, name: x.name, source: 'project', transport, url: x.url };
  }

  if (typeof x.command !== 'string') return null;
  return {
    id,
    name: x.name,
    source: 'project',
    transport,
    command: x.command,
    args: Array.isArray(x.args) ? x.args.map(String) : [],
    env: x.env && typeof x.env === 'object' ? (x.env as Record<string, string>) : {},
    dir: typeof x.dir === 'string' ? expandHome(x.dir) : undefined,
    port: typeof x.port === 'number' ? x.port : undefined,
    healthPath: typeof x.healthPath === 'string' ? x.healthPath : undefined,
  };
}
