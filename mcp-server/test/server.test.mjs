// End-to-end over the MCP protocol: a 2026-07-28 client (official SDK) and a raw
// 2025-era stateless request, both against the real SQL on PGlite (no network).
// Run: npm test   (from mcp-server/; needs `npm install` in the repo root too)
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { db } from '../../scripts/pg.mjs'
import { createHandler, TOOLS } from '../src/server.js'

const SECRET = 'server-test-'.padEnd(40, 'z')
await db.query('select private.set_mcp_secret($1)', [SECRET])

// Same contract as supabaseBackend(), but on PGlite as the anon role with the secret header.
const backend = {
  secret: SECRET,
  call: (tool, args, { client, clientName }) => db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.headers', $1, true),
      set_config('search_path', 'public, extensions', true)`, [JSON.stringify({ 'x-mcp-secret': SECRET })])
    await tx.query('set local role anon')
    return (await tx.query('select public.mcp_call($1, $2, $3, $4) r', [tool, JSON.stringify(args), client, clientName])).rows[0].r
  }),
}
const handle = createHandler(backend, (req) => req?.headers.get('x-test-client') ?? 'default')
const URL_ = 'http://localhost/mcp'

// ---- modern client (official SDK), pinned so a silent fallback to 2025 fails the test
const versions = new Set()
const client = new Client({ name: 'safearrival-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
await client.connect(new StreamableHTTPClientTransport(new URL(URL_), {
  fetch: (u, init) => { const r = new Request(u, init); versions.add(r.headers.get('mcp-protocol-version')); return handle(r) },
}))
const { tools } = await client.listTools()
assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort(), 'all tools listed')
assert.ok(tools.every((t) => t.description.length > 80 && t.inputSchema?.type === 'object' && t.annotations))
assert.equal(tools.find((t) => t.name === 'report_safety_incident').annotations.readOnlyHint, false)

const area = await client.callTool({ name: 'check_area_safety', arguments: { latitude: -33.9697, longitude: 18.5968, radius_km: 3 } })
assert.ok(!area.isError, area.content?.[0]?.text)
assert.ok(area.structuredContent.summary.total_reports > 0)
assert.equal(JSON.parse(area.content[0].text).summary.total_reports, area.structuredContent.summary.total_reports, 'text mirrors structured data')

// zod rejects bad input before it reaches the database
const bad = await client.callTool({ name: 'check_area_safety', arguments: { latitude: 999, longitude: 18 } })
assert.equal(bad.isError, true)
const half = await client.callTool({ name: 'get_safety_alerts', arguments: { latitude: -33.9 } })
assert.equal(half.isError, true)

const em = await client.callTool({ name: 'find_emergency_services', arguments: {} })
assert.equal(em.structuredContent.emergency_numbers[0].number, '10111')

const unconfirmed = await client.callTool({ name: 'report_safety_incident', arguments: { category: 'other', description: 'test report text', user_confirmed: false } })
assert.equal(unconfirmed.isError, true)
assert.match(unconfirmed.content[0].text, /confirm/)

assert.ok(versions.has('2026-07-28') && !versions.has('2025-11-25'), `modern era used: ${[...versions]}`)

// ---- 2025-era client: stateless JSON-RPC POST, no session
const legacy = await handle(new Request(URL_, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', 'x-test-client': 'legacy' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_pickup_guidance', arguments: { pickup_point: 'cpt-intl' } } }),
}))
assert.equal(legacy.status, 200)
const text = await legacy.text()
const msg = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:')).slice(5))
assert.equal(msg.result.structuredContent.pickup_point.id, 'cpt-intl')

// ---- CORS preflight for browser-based clients
const pre = await handle(new Request(URL_, { method: 'OPTIONS' }))
assert.equal(pre.status, 204)
assert.match(pre.headers.get('access-control-allow-headers'), /Mcp-Protocol-Version/)

// ---- usage is logged with the client name, never the arguments
const logs = (await db.query(`select tool, status, client_name from mcp_requests`)).rows
assert.ok(logs.some((l) => l.tool === 'check_area_safety' && l.status === 'ok'))
assert.ok(!JSON.stringify(logs).includes('cpt-intl'))

await client.close()
console.log(`✓ MCP server: ${tools.length} tools over 2026-07-28 and 2025 Streamable HTTP, validation, CORS, logging`)
