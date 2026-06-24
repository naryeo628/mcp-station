import type { RawSource } from './discover.js';
import type { ServerDef } from '../types.js';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Normalize raw server maps into ServerDef[], deduping identical servers across sources. */
export function normalize(sources: RawSource[]): ServerDef[] {
  const defs: ServerDef[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    for (const [name, raw] of Object.entries(src.servers)) {
      const def = toDef(src.source, name, raw);
      if (!def) continue;
      const key = signature(def);
      if (seen.has(key)) continue; // first source wins
      seen.add(key);
      defs.push(def);
    }
  }
  return defs;
}

function toDef(source: string, name: string, raw: unknown): ServerDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const id = `${source}:${slug(name)}`;

  // Remote: a url with no command, or an explicit sse/http type.
  const remoteType = r.type === 'sse' || r.type === 'http' || r.type === 'streamable-http';
  if (typeof r.url === 'string' && (!r.command || remoteType)) {
    return { id, name, source, transport: 'remote', url: r.url };
  }

  // stdio: spawned via command + args.
  if (typeof r.command === 'string') {
    return {
      id,
      name,
      source,
      transport: 'stdio',
      command: r.command,
      args: Array.isArray(r.args) ? r.args.map(String) : [],
      env: r.env && typeof r.env === 'object' ? (r.env as Record<string, string>) : {},
    };
  }

  return null;
}

function signature(d: ServerDef): string {
  if (d.transport === 'remote') return `remote:${d.url}`;
  return `stdio:${d.command} ${(d.args ?? []).join(' ')}`;
}
