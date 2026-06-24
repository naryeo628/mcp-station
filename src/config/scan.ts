import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

/** A guessed project entry. `note` explains the guess and is stripped before saving. */
export interface Draft {
  name: string;
  dir: string;
  command: string;
  args: string[];
  transport: 'stdio';
  note: string;
}

const SKIP = new Set([
  'node_modules', 'venv', '.venv', '__pycache__', 'dist', 'build', '.git', 'target',
]);

/** Walk `parent` up to `depth` levels and detect runnable MCP-ish projects. */
export async function scan(parent: string, depth = 2): Promise<Draft[]> {
  const out: Draft[] = [];
  await walk(parent, depth, out);
  return out;
}

async function walk(dir: string, depth: number, out: Draft[]): Promise<void> {
  if (depth < 0) return;
  const found = await detect(dir);
  if (found) {
    out.push(found);
    return; // a project dir; don't descend into it
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
    await walk(join(dir, e.name), depth - 1, out);
  }
}

async function detect(dir: string): Promise<Draft | null> {
  const folder = basename(dir);

  // --- Node / TypeScript ---
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const name = pkg.name || folder;
      const scripts: Record<string, string> = pkg.scripts ?? {};
      const script = ['start', 'serve', 'mcp', 'dev'].find((s) => scripts[s]);
      if (script) {
        return mk(name, dir, 'npm', ['run', script], `npm script "${script}"`);
      }
      if (pkg.bin) {
        const bin = typeof pkg.bin === 'string' ? pkg.bin : (Object.values(pkg.bin)[0] as string);
        return mk(name, dir, 'node', [bin], 'package.json "bin"');
      }
      return mk(name, dir, 'npm', ['start'], 'no start script — VERIFY');
    } catch {
      /* fall through */
    }
  }

  // --- Python ---
  const hasUv = existsSync(join(dir, 'uv.lock')) || existsSync(join(dir, 'pyproject.toml'));
  const entry = ['server.py', 'main.py', 'app.py', '__main__.py'].find((f) =>
    existsSync(join(dir, f)),
  );
  if (hasUv || entry) {
    if (hasUv) {
      return entry
        ? mk(folder, dir, 'uv', ['run', entry], `uv run ${entry}`)
        : mk(folder, dir, 'uv', ['run', 'python', '-m', folder.replace(/-/g, '_')], 'uv run module — VERIFY');
    }
    return mk(folder, dir, 'python', [entry ?? 'main.py'], `python ${entry ?? 'main.py'} — VERIFY`);
  }

  return null;
}

function mk(name: string, dir: string, command: string, args: string[], note: string): Draft {
  return { name, dir, command, args, transport: 'stdio', note };
}
