// Checks that a deployed server exposes exactly the local tool definitions.
//   node test/parity.mjs https://safearrival-mcp.vercel.app/mcp
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createHandler } from '../src/server.js'

const list = async (transport) => { const c = new Client({ name: 'parity', version: '1' }); await c.connect(transport); const t = (await c.listTools()).tools; await c.close(); return t }
const local = createHandler({ secret: 'x', call: async () => ({ ok: true, data: {} }) }, () => 'k')
const want = await list(new StreamableHTTPClientTransport(new URL('http://local/mcp'), { fetch: (u, i) => local(new Request(u, i)) }))
const got = await list(new StreamableHTTPClientTransport(new URL(process.argv[2])))
assert.deepEqual(got, want, 'deployed tool definitions differ from local src/server.js')
console.log(`✓ deployed tools identical to local (${got.length} tools)`)
