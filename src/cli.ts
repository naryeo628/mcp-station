#!/usr/bin/env node
import { discover } from './config/discover.js';
import { normalize } from './config/parse.js';
import { Supervisor } from './supervisor.js';
import { createControlServer } from './server.js';

const DEFAULT_PORT = 4040;

function checkNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`mcp-station needs Node >= 18 (you have ${process.versions.node}). Try: nvm use 20`);
    process.exit(1);
  }
}

async function load(extra: string[]) {
  const raw = await discover(extra);
  return { raw, defs: normalize(raw) };
}

async function main(): Promise<void> {
  checkNode();
  const [cmd = 'serve'] = process.argv.slice(2);
  const port = Number(process.env.MCP_STATION_PORT ?? DEFAULT_PORT);

  if (cmd === 'list') {
    const { raw, defs } = await load([]);
    console.log(`Discovered ${defs.length} server(s) from ${raw.length} config file(s):`);
    for (const r of raw) console.log(`  · ${r.source}  (${r.path})`);
    console.log('');
    for (const d of defs) {
      const detail = d.transport === 'remote' ? d.url : `${d.command} ${(d.args ?? []).join(' ')}`;
      console.log(`  [${d.transport.padEnd(6)}] ${d.name.padEnd(22)} ${d.source.padEnd(14)} ${detail}`);
    }
    return;
  }

  if (cmd === 'serve' || cmd === 'up') {
    const { defs } = await load([]);
    const sup = new Supervisor(defs);
    createControlServer(sup, port);
    const url = `http://localhost:${port}`;
    console.log(`mcp-station: dashboard → ${url}   (${defs.length} servers)`);

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

  console.error(`Unknown command "${cmd}".\nUsage: mcp-station [serve|up|list]`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
