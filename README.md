# ⚡ mcp-station

Launch **all your local MCP projects at once** and manage them from one dashboard
— instead of opening a terminal per project.

Register your own MCP project folders in a manifest (a TypeScript project runs
`npm run start`, a Python one `uv run server.py`, etc.). `mcp-station` runs each
in its own directory, wraps **stdio** projects in a local SSE gateway so they
become persistent URLs, health-checks **http**/self-hosted and **remote** ones,
and serves a live control dashboard at `http://localhost:4040`. It also picks up
the servers already defined in your client configs (Cursor, Claude, VS Code).

> 📊 **Docs / live demo:** https://naryeo628.github.io/mcp-station/
> (The Pages site is a read-only demo — the real dashboard runs locally, see below.)

---

## Your own MCP projects (the main use case)

Register each local project once, in `~/.mcp-station/projects.json`:

```jsonc
{
  "includeClientConfigs": true,        // also pull in Cursor/Claude/VS Code servers
  "projects": [
    { "name": "my-ts-mcp", "dir": "~/work/mcp/ts-svc", "command": "npm", "args": ["run", "start"], "transport": "stdio" },
    { "name": "my-py-mcp", "dir": "~/work/mcp/py-svc", "command": "uv",  "args": ["run", "server.py"], "transport": "stdio" },
    { "name": "http-svc",  "dir": "~/work/mcp/http",   "command": "npm", "args": ["run", "serve"], "transport": "http", "port": 8000, "healthPath": "/health" },
    { "name": "figma",     "transport": "remote", "url": "https://mcp.figma.com/mcp" }
  ]
}
```

A starter file lives in [`examples/projects.json`](examples/projects.json).
Lookup order: `$MCP_STATION_MANIFEST` → `./mcp-station.json` → `~/.mcp-station/projects.json`.

Don't want to write it by hand? Let `scan` draft it from your projects folder:

```bash
mcp-station scan ~/work/mcp > ~/.mcp-station/projects.json
# detects package.json / pyproject.toml, guesses the run command (entries
# marked "VERIFY" are best-effort — check them). Then edit and save.
```

### Per-project transports

| `transport` | What it means | What mcp-station does |
|-------------|---------------|------------------------|
| `stdio` *(default)* | server talks over stdin/stdout (the MCP norm) | runs it in `dir`, wraps it with [`supergateway`](https://github.com/supercorp-ai/supergateway) → `http://localhost:91xx/sse` |
| `http` | server binds its own port (self-hosted HTTP/SSE) | runs it in `dir`, health-checks `http://localhost:<port><healthPath>` |
| `remote` | already hosted elsewhere | only health-checks the `url`, never spawns |

Why this matters: a bare **stdio** server left running in a terminal does
nothing useful — it just waits on stdin. The gateway turns it into a persistent
URL any MCP client can connect to. That's what makes "start everything" real.

---

## Quick start

Requires **Node ≥ 18** (the default macOS Node may be older — `nvm use 20`).

```bash
# from a clone
npm install
npm run build:all        # builds the daemon + the dashboard
npm run start            # serve dashboard, start servers from the UI

# or start the daemon AND spin up every server immediately
node dist/cli.js up
```

Then open **http://localhost:4040**.

### CLI

```bash
mcp-station serve        # serve dashboard + API (default); start servers from the UI
mcp-station up           # serve + start every server right away
mcp-station list         # print all registered servers and exit
mcp-station scan <dir>   # draft a manifest from a projects folder (prints JSON)
```

Environment:

- `MCP_STATION_PORT` — dashboard/control port (default `4040`).

---

## Where it reads servers from

1. **Your manifest** — `~/.mcp-station/projects.json` (your own projects; see above).
2. **Client configs** — auto-discovered unless `includeClientConfigs: false`:

| Source | Path |
|--------|------|
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude.json` (global + per-project `mcpServers`) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| VS Code | `~/.vscode/mcp.json` |

Manifest entries win; duplicate client servers are merged. Both client shapes are understood:

```jsonc
{
  "mcpServers": {
    "memory":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"], "env": { "MEMORY_FILE_PATH": "..." } },
    "figma":   { "url": "https://mcp.figma.com/mcp" }
  }
}
```

---

## Architecture

```
 ~/.mcp-station/projects.json ┐
 ~/.cursor/mcp.json           ├─ load ─► normalize/dedupe ─► ServerDef[]
 ~/.claude.json (+ desktop)   ┘                                 │
                                                                ▼
                                          ┌────────── Supervisor ──────────┐
                  stdio project ─────────►│ run in dir + `supergateway`     │──► http://localhost:91xx/sse
                  http  project ─────────►│ run in dir, health-check port   │──► http://localhost:<port>
                          stdio server ──►│ spawn `npx supergateway`        │──► http://localhost:91xx/sse
                          remote server ─►│ fetch() health-check            │──► (status only)
                                          └───────────────┬─────────────────┘
                                                          │ events (status / log)
                                          HTTP + WebSocket control API + static dashboard
                                                          │
                                                   http://localhost:4040  ◄── browser
```

- **Daemon** (`src/`): TypeScript, Node built-in `http`/`child_process`, `ws`. No MCP protocol re-implementation — `supergateway` handles the stdio↔SSE bridge.
- **Dashboard** (`web/`): Vue 3 + Vite. Served by the daemon at localhost; same build is published to GitHub Pages in **demo mode**.

### Why the GitHub Pages site is a demo

GitHub Pages is static hosting and cannot run processes on your machine. A
page served over **https** also can't talk to `http://localhost` (mixed-content
blocking). So the real control UI is served by the daemon over plain
`http://localhost:4040`, where there's no mixed-content wall. Pages hosts the
docs + a mock-data preview.

---

## Development

```bash
# terminal 1 — daemon with hot reload
npm run dev

# terminal 2 — dashboard with HMR (proxies /api and /ws to the daemon)
npm --prefix web run dev
```

---

## Roadmap

- [ ] Persist last-known ports across restarts
- [ ] Per-server enable/disable + autostart flags
- [ ] Export a merged `mcp.json` pointing every client at the gateways
- [ ] Optional auth token on the control API

## License

MIT © naryeo628
