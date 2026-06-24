#!/usr/bin/env node
import { discover } from './config/discover.js';
import { normalize } from './config/parse.js';
import { loadManifest, expandHome } from './config/manifest.js';
import { scan } from './config/scan.js';
import { Supervisor } from './supervisor.js';
import { createControlServer } from './server.js';
import type { ServerDef } from './types.js';

const DEFAULT_PORT = 4040;

function checkNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`mcp-station needs Node >= 18 (you have ${process.versions.node}). Try: nvm use 20`);
    process.exit(1);
  }
}

interface Loaded {
  defs: ServerDef[];
  manifestPath?: string;
  clientCount: number;
  clients: boolean;
}

async function load(): Promise<Loaded> {
  const manifest = await loadManifest();
  const defs = [...manifest.defs];
  let clientCount = 0;
  if (manifest.includeClientConfigs) {
    const raw = await discover([]);
    clientCount = raw.length;
    const existing = new Set(defs.map((d) => d.id));
    for (const d of normalize(raw)) if (!existing.has(d.id)) defs.push(d);
  }
  return { defs, manifestPath: manifest.path, clientCount, clients: manifest.includeClientConfigs };
}

async function main(): Promise<void> {
  checkNode();
  const [cmd = 'serve'] = process.argv.slice(2);
  const port = Number(process.env.MCP_STATION_PORT ?? DEFAULT_PORT);

  if (cmd === 'scan') {
    const dir = process.argv[3];
    if (!dir) {
      console.error('Usage: mcp-station scan <parent-dir>');
      process.exit(1);
    }
    const drafts = await scan(expandHome(dir));
    console.error(`Found ${drafts.length} project(s) under ${dir}:`);
    for (const d of drafts) console.error(`  · ${d.name.padEnd(24)} ${d.command} ${d.args.join(' ')}   — ${d.note}`);
    console.error('\nReview, then save to ~/.mcp-station/projects.json :\n');
    const manifest = {
      includeClientConfigs: true,
      projects: drafts.map(({ note, ...rest }) => rest),
    };
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (cmd === 'list') {
    const { defs, manifestPath, clientCount, clients } = await load();
    console.log(`Manifest: ${manifestPath ?? '(none — using client configs only)'}`);
    console.log(`Client configs: ${clients ? `${clientCount} file(s)` : 'disabled'}`);
    console.log(`\n${defs.length} server(s):`);
    for (const d of defs) {
      const detail = d.transport === 'remote' ? d.url : `${d.command} ${(d.args ?? []).join(' ')}`;
      const where = d.dir ? `  @ ${d.dir}` : '';
      console.log(`  [${d.transport.padEnd(6)}] ${d.name.padEnd(22)} ${d.source.padEnd(14)} ${detail}${where}`);
    }
    return;
  }

  if (cmd === 'serve' || cmd === 'up') {
    const { defs, manifestPath, clientCount } = await load();
    const sup = new Supervisor(defs);
    createControlServer(sup, port);
    const src = `${manifestPath ? 'manifest + ' : ''}${clientCount} client config(s)`;
    console.log(`mcp-station: dashboard → http://localhost:${port}   (${defs.length} servers from ${src})`);

    if (cmd === 'up') {
      console.log('Starting all servers…');
      await sup.startAll();
    }

    const shutdown = async () => {
      console.log('\nStopping servers…');
      await sup.stopAll();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.error(`Unknown command "${cmd}".\nUsage: mcp-station [serve|up|list|scan <dir>]`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
