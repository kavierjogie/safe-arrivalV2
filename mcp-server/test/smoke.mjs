// Smoke test against a RUNNING server over real HTTP (local or deployed).
//   node test/smoke.mjs http://127.0.0.1:8787/mcp
//   node test/smoke.mjs https://<your-mcp>.vercel.app/mcp
// Read-only: it never submits a report.
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8787/mcp')
const check = async (label, fn) => { const t = Date.now(); await fn(); console.log(`✓ ${label} (${Date.now() - t} ms)`) }

for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
  const client = new Client({ name: 'safearrival-smoke', version: '1.0.0' }, { versionNegotiation: { mode } })
  await client.connect(new StreamableHTTPClientTransport(url))
  const era = typeof mode === 'string' ? '2025' : mode.pin
  await check(`[${era}] tools/list`, async () => assert.equal((await client.listTools()).tools.length, 11))
  await check(`[${era}] check_area_safety near CPT airport`, async () => {
    const r = await client.callTool({ name: 'check_area_safety', arguments: { latitude: -33.9697, longitude: 18.5968, radius_km: 3, location_name: 'Cape Town International Airport' } })
    assert.ok(!r.isError, r.content?.[0]?.text)
    const s = r.structuredContent.summary
    console.log(`    ${s.total_reports} reports: ${s.verified_incidents} verified, ${s.unverified_reports} unverified, ${s.safety_advisories} advisory`)
  })
  await check(`[${era}] get_pickup_guidance`, async () => {
    const r = await client.callTool({ name: 'get_pickup_guidance', arguments: { hotel: 'Saltwater Lodge' } })
    assert.equal(r.structuredContent.pickup_point.id, 'cpt-intl')
  })
  await check(`[${era}] find_emergency_services`, async () => {
    const r = await client.callTool({ name: 'find_emergency_services', arguments: {} })
    assert.equal(r.structuredContent.emergency_numbers[0].number, '10111')
  })
  await client.close()
}
console.log(`All smoke checks passed against ${url}`)
