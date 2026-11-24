// The public SafeArrival MCP endpoint, plus a tiny browser client for the developer
// portal and admin status. Uses plain stateless Streamable HTTP JSON-RPC (2025 era),
// which the server accepts without a session, so no SDK lands in the web bundle.
export const MCP_URL = import.meta.env.VITE_MCP_URL || 'https://safearrival-mcp.vercel.app/mcp'
export const HEALTH_URL = MCP_URL.replace(/\/mcp$/, '/health')
export const REPO_URL = 'https://github.com/kavierjogie/safe-arrivalV2'

let id = 0
async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  })
  if (!res.ok) throw new Error(`MCP server answered ${res.status}`)
  const text = await res.text()
  // Responses may be plain JSON or a one-message SSE stream ("event: message\ndata: {...}").
  const msg = JSON.parse(text.trimStart().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:')).slice(5))
  if (msg.error) throw new Error(msg.error.message)
  return msg.result
}

export const listTools = async () => (await rpc('tools/list', {})).tools
export const callTool = (name, args) => rpc('tools/call', { name, arguments: args })

export async function serverHealth() {
  const t0 = performance.now()
  const res = await fetch(HEALTH_URL, { cache: 'no-store' })
  return { ...(await res.json()), http: res.status, roundtrip_ms: Math.round(performance.now() - t0) }
}
