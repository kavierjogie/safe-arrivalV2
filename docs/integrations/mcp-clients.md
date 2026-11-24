# Other MCP clients and developer setup

**Remote URL:** `https://safearrival-mcp.vercel.app/mcp` (Streamable HTTP, no auth). The server speaks MCP **2026-07-28**
and falls back to stateless 2025-era Streamable HTTP for older clients. The legacy HTTP+SSE transport is not offered.

## Cursor: `~/.cursor/mcp.json` or `.cursor/mcp.json`
```json
{ "mcpServers": { "safearrival": { "url": "https://safearrival-mcp.vercel.app/mcp" } } }
```

## VS Code (Copilot agent mode): `.vscode/mcp.json`
```json
{ "servers": { "safearrival": { "type": "http", "url": "https://safearrival-mcp.vercel.app/mcp" } } }
```

## Claude Code
```bash
claude mcp add --transport http safearrival https://safearrival-mcp.vercel.app/mcp
```

## MCP Inspector (debugging)
```bash
npx @modelcontextprotocol/inspector
```
Choose **Streamable HTTP**, paste the URL, then **Connect → Tools**.

## From code (official TypeScript SDK v2)
```js
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const client = new Client({ name: 'my-app', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL('https://safearrival-mcp.vercel.app/mcp')))
const res = await client.callTool({ name: 'check_area_safety', arguments: { latitude: -33.9697, longitude: 18.5968, radius_km: 3 } })
console.log(res.structuredContent.summary)
```
Every tool returns `structuredContent` (JSON) and the same data as text. Errors come back as `isError: true` with a
message and a code: `invalid`, `rate_limited`, `disabled`, `not_found` or `error`.

## Self-hosting / local stdio
Running your own copy needs your own Supabase project with the migrations in `supabase/migrations/`
(see [mcp-server/README.md](../../mcp-server/README.md)). Then a desktop client can launch it over stdio:
```json
{
  "mcpServers": {
    "safearrival-local": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/src/stdio.js"],
      "env": { "SUPABASE_URL": "…", "SUPABASE_ANON_KEY": "…", "MCP_SERVER_SECRET": "…" }
    }
  }
}
```

## Limits and etiquette
- 60 calls per minute and 3 incident reports per hour per caller (salted IP hash).
- Data covers Cape Town. Outside it, tools return `coverage.covered: false`.
- The hackathon deployment holds fictional demo data, flagged in every response (`data_notice`).
- Show users the verification status and limitations fields; don't turn results into safety scores.
