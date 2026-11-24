// Local Streamable HTTP server: http://127.0.0.1:8787/mcp  (npm run dev)
import { createServer } from 'node:http'
import { supabaseBackend, clientKey } from './backend.js'
import { createHandler } from './server.js'

const backend = supabaseBackend()
const handle = createHandler(backend, () => clientKey('local-dev', backend.secret))
const port = Number(process.env.PORT ?? 8787)

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/mcp') { res.writeHead(404).end('Not found. MCP endpoint: /mcp'); return }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const response = await handle(new Request(url, { method: req.method, headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }))
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body) for await (const c of response.body) res.write(c)
  res.end()
}).listen(port, '127.0.0.1', () => console.log(`SafeArrival MCP on http://127.0.0.1:${port}/mcp`))
