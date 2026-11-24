// GET /health: liveness + database reachability, for monitoring and the admin dashboard.
import { supabaseBackend } from '../src/backend.js'
import { VERSION } from '../src/server.js'

const backend = supabaseBackend()

export async function GET() {
  const t0 = Date.now()
  const r = await backend.call('find_emergency_services', {}, { client: 'health-check', clientName: 'health-check' })
  return Response.json({ ok: Boolean(r?.ok), version: VERSION, database: r?.ok ? 'reachable' : 'unreachable', latency_ms: Date.now() - t0,
    checked_at: new Date().toISOString() }, { status: r?.ok ? 200 : 503, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } })
}
