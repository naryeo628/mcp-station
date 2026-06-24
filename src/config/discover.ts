import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Raw server map read from one client config file. */
export interface RawSource {
  source: string;
  path: string;
  servers: Record<string, unknown>;
}

interface SourceSpec {
  source: string;
  path: string;
  /** Pull the server map out of a parsed config (shape differs per client). */
  pick: (json: any) => Record<string, unknown> | undefined;
}

const home = homedir();

const SOURCES: SourceSpec[] = [
  {
    source: 'cursor',
    path: join(home, '.cursor', 'mcp.json'),
    pick: (j) => j?.mcpServers,
  },
  {
    source: 'claude-code',
    path: join(home, '.claude.json'),
    // Claude Code keeps a global map plus per-project maps; merge both.
    pick: (j) => mergeClaudeCode(j),
  },
  {
    source: 'claude-desktop',
    path: join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    ),
    pick: (j) => j?.mcpServers,
  },
  {
    source: 'vscode',
    path: join(home, '.vscode', 'mcp.json'),
    pick: (j) => j?.servers ?? j?.mcpServers,
  },
];

function mergeClaudeCode(j: any): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(j?.mcpServers ?? {}) };
  if (j?.projects && typeof j.projects === 'object') {
    for (const proj of Object.values<any>(j.projects)) {
      if (proj?.mcpServers && typeof proj.mcpServers === 'object') {
        for (const [name, def] of Object.entries(proj.mcpServers)) {
          if (!(name in out)) out[name] = def;
        }
      }
    }
  }
  return out;
}

/** Read all known client configs (plus any extra paths) and return their raw server maps. */
export async function discover(extraPaths: string[] = []): Promise<RawSource[]> {
  const specs: SourceSpec[] = [...SOURCES];
  for (const p of extraPaths) {
    specs.push({ source: `custom:${p}`, path: p, pick: (j) => j?.mcpServers ?? j?.servers });
  }

  const out: RawSource[] = [];
  for (const spec of specs) {
    if (!existsSync(spec.path)) continue;
    try {
      const txt = await readFile(spec.path, 'utf8');
      const json = JSON.parse(txt);
      const servers = spec.pick(json);
      if (servers && Object.keys(servers).length > 0) {
        out.push({ source: spec.source, path: spec.path, servers });
      }
    } catch {
      // Unreadable or non-JSON config — skip silently.
    }
  }
  return out;
}
