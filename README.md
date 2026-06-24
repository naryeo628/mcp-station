# ⚡ mcp-station

Launch **all your local MCP servers at once** and manage them from one dashboard.

`mcp-station` reads the MCP server definitions you already have (Cursor, Claude
Code, Claude Desktop, VS Code), wraps every **stdio** server in a local
**SSE/HTTP gateway** so it becomes a persistent endpoint any client can connect
to, health-checks your **remote** servers, and serves a live control dashboard
at `http://localhost:4040`.

> 📊 **Docs / live demo:** https://naryeo628.github.io/mcp-station/
> (The Pages site is a read-only demo — the real dashboard runs locally, see below.)

---

## Why this exists

MCP servers come in two flavors, and they behave very differently:

| Type | Example | How it runs |
|------|---------|-------------|
| **stdio** | `npx @playwright/mcp`, `server-memory` | Talks over **stdin/stdout**, no port. A client normally spawns a *fresh* copy per connection. You can't "just leave it running" usefully. |
| **remote** | `https://mcp.figma.com/mcp` | Already hosted elsewhere. Nothing to launch locally. |

`mcp-station` makes "start everything" actually meaningful:

- **stdio → gateway:** each stdio server is wrapped by [`supergateway`](https://github.com/supercorp-ai/supergateway) and exposed at `http://localhost:91xx/sse`. It stays up, and any MCP client can connect by URL.
- **remote → health-check:** remote servers are pinged so you can see at a glance whether they're reachable.

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
mcp-station serve     # serve dashboard + API (default); start servers from the UI
mcp-station up        # serve + start every server right away
mcp-station list      # print discovered servers and exit
```

Environment:

- `MCP_STATION_PORT` — dashboard/control port (default `4040`).

---

## Where it reads servers from

Auto-discovered (first match wins, duplicates merged):

| Source | Path |
|--------|------|
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude.json` (global + per-project `mcpServers`) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| VS Code | `~/.vscode/mcp.json` |

Both shapes are understood:

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
 ~/.cursor/mcp.json ┐
 ~/.claude.json     ├─ discover ─► normalize/dedupe ─► ServerDef[]
 (claude desktop)   ┘                                     │
                                                          ▼
                                          ┌────────── Supervisor ──────────┐
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
