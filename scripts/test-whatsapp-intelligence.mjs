// WhatsApp intelligence: hybrid menu + free text, MCP parity (same SQL tools, same answers),
// source-of-truth labelling, structured incident cases and their security.
// Run: npm run test:wa
import assert from 'node:assert/strict'
import { db, U, as, rpc } from './pg.mjs'
import { detectIntent, handle } from '../supabase/functions/_shared/conversation.js'

const SECRET = 'test-secret-'.padEnd(40, 'x')
await db.query(`select private.set_mcp_secret($1)`, [SECRET])
const mcp = (tool, args) => db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.headers', $1, true), set_config('search_path', 'public, extensions', true)`,
    [JSON.stringify({ 'x-mcp-secret': SECRET })])
  await tx.query('set local role anon')
  return (await tx.query('select public.mcp_call($1, $2, $3, $4) r', [tool, JSON.stringify(args), 'mcp-client', 'claude-ai'])).rows[0].r
})
// The webhook calls RPCs with the service-role key (PostgREST claims role = service_role).
const asService = (fn, args) => db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('search_path', 'public, extensions', true)`)
  const keys = Object.keys(args)
  return (await tx.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, Object.values(args))).rows[0].r
})

const api = {
  hotels: () => as(null, `select slug, name, area, phone from hotels where status = 'active' order by name`),
  pickupPoints: () => as(null, `select * from pickup_points order by kind, name`),
  options: () => [],
  getTrip: (t) => rpc(null, 'get_trip', { p_token: t }),
  reportIncident: (p) => asService('report_incident', { p: JSON.stringify(p) }),
  checkAccommodation: (p) => rpc(null, 'check_accommodation', { p: JSON.stringify(p) }),
  checkProvider: (p) => rpc(null, 'check_transport_provider', { p: JSON.stringify(p) }),
  getIncident: (t) => rpc(null, 'get_incident', { p_token: t }),
  guidance: (stage) => rpc(null, 'safety_guidance', { p_stage: stage }),
  requestFeedback: (p) => rpc(null, 'request_feedback', { p: JSON.stringify(p) }),
  submitFeedback: (p) => rpc(null, 'submit_feedback', { p: JSON.stringify(p) }),
  tool: (name, args) => rpc(null, 'assistant_tool', { p_tool: name, p_args: JSON.stringify(args), p_client: '27820000001' }),
  resolvePlace: (q) => rpc(null, 'resolve_place', { p_query: q }),
  categoryInfo: (c) => rpc(null, 'incident_category_info', { p_category: c }),
  followup: (t, kind, msg) => rpc(null, 'incident_followup', { p_token: t, p_kind: kind, p_message: msg }),
  tripLink: (t) => `https://example.test/trip/${t}`, incidentLink: (t) => `https://example.test/incident/${t}`,
  statusLabel: (s) => s, fmtTime: (d) => String(d).slice(0, 16), priceText: () => 'R450',
}

let session = { state: 'WELCOME', ctx: { hotelSlug: 'hotel-001', hotelName: 'Saltwater Lodge', phone: '+27820000001' } }
const say = async (input) => {
  const r = await handle(session, typeof input === 'string' ? { text: input } : input, api)
  session = r.session
  for (const m of r.replies) {
    if (m.type === 'buttons') assert.ok(m.buttons.length <= 3 && m.buttons.every((b) => b.title.length <= 20 && m.text.length <= 1024), 'WhatsApp button limits')
    if (m.type === 'list') assert.ok(m.rows.length <= 10 && m.rows.every((x) => x.title.length <= 24 && (x.description ?? '').length <= 72), 'WhatsApp list limits')
    if (m.type === 'text') assert.ok(m.text.length <= 4096, 'WhatsApp text limit')
  }
  return r.replies
}
const all = (rs) => rs.map((m) => m.text).join('\n---\n')

// ================================================================ intent rules (pure)
const I = (t, ctx) => detectIntent(t, ctx)
assert.equal(I('Is the area around my hotel covered by any current advisories?').intent, 'AREA_SAFETY')
assert.equal(I('Can you check this transport company?').intent, 'TRANSPORT_PROVIDER_CHECK')
assert.deepEqual(I('What should I do if my driver is asking for extra money?'), { intent: 'SAFETY_GUIDANCE', category: 'extra_payment' })
assert.equal(I('Is there a reported issue along my route?').intent, 'ROUTE_SAFETY')
assert.equal(I('How can I verify my accommodation?').intent, 'ACCOMMODATION_CHECK')
assert.deepEqual(I('What should I do if the driver gives me a different code?'), { intent: 'SAFETY_GUIDANCE', category: 'code_incorrect' })
assert.equal(I('I want to speak to someone.').intent, 'HUMAN_SUPPORT')
assert.equal(I('Can you explain how the verification process works?').intent, 'HOW_IT_WORKS')
assert.deepEqual(I('Someone at the airport is asking me to pay an extra airport fee.'), { intent: 'INCIDENT_REPORT', category: 'extra_payment' })
assert.deepEqual(I('My driver has a different number plate.'), { intent: 'INCIDENT_REPORT', category: 'vehicle_mismatch' })
for (const w of ['hi', 'menu', 'restart', 'help', 'Hello!']) assert.equal(I(w).intent, 'MAIN_MENU', w)
assert.equal(I('help me someone has a knife').intent, 'EMERGENCY')
assert.equal(I('I am safe now', { lastIncidentToken: 'x' }).kind, 'safe')

// ================================================================ menu
let r = await say('hi')
assert.match(r[0].text, /choose an option below or simply type/i)
assert.deepEqual(r[1].rows.map((x) => x.id), ['area', 'route', 'provider', 'accom', 'view', 'verify', 'wrong', 'status', 'tips', 'emergency'])
for (const [id, state] of [['area', 'AREA_QUERY'], ['route', 'ROUTE_FROM'], ['provider', 'PROVIDER_QUERY'], ['accom', 'ACCOM_QUERY'], ['view', 'NO_BOOKING'],
  ['verify', 'NO_BOOKING'], ['wrong', 'REPORT_SERVICE'], ['status', 'STATUS_QUERY'], ['tips', 'SAFETY_MENU'], ['emergency', 'ANSWERED']]) {
  await say({ id: 'menu' }); await say({ id }); assert.equal(session.state, state, `menu row ${id}`)
}
r = await say({ id: 'menu' }); r = await say('2')
assert.equal(session.state, 'ROUTE_FROM', 'typing a row number works')
r = await say('menu')
assert.equal(session.state, 'MENU', 'menu works mid-flow')
await say({ id: 'view' }); r = await say({ id: 'arrange' })
assert.equal(session.state, 'PICKUP', 'booking is still reachable from My booking')

// ================================================================ free text: questions answered from the shared tools
session = { state: 'MENU', ctx: { ...session.ctx, paused: null } }
r = await say('Is Sea Point safe at the moment?')
assert.equal(session.state, 'ANSWERED')
assert.match(r[0].text, /\*Sea Point\* — SafeArrival records/)
assert.match(r[0].text, /does not mean the area is safe/i, 'no reports ≠ safe')
assert.doesNotMatch(r[0].text.replace(/does not mean the area is safe|as safe or dangerous/gi, ''), /\b(safe|dangerous)\b/i, 'no safety verdict')
r = await say('Is the area around my hotel covered by any current advisories?')
assert.match(r[0].text, /\*Sea Point\*/, '"my hotel" resolves to the hotel’s area')
r = await say({ id: 'menu' })
r = await say('what about the airport area?')
assert.match(r[0].text, /🛡️ SAFETY ADVISORY \(1\)[\s\S]*✅ VERIFIED INCIDENT[\s\S]*⚠️ UNVERIFIED REPORT/, 'classified separately')
assert.match(r[0].text, /reported \d{4}-\d{2}-\d{2}, reviewed \d{4}-\d{2}-\d{2}/, 'dates on verified items')
assert.match(r[0].text, /not yet confirmed/, 'unverified labelled as such')
assert.match(r[0].text, /DEMO DATA/)
assert.doesNotMatch(r[0].text, /A man at the pickup|Someone held a sign|Advisory issued by/, 'raw descriptions never shown')

// parity: the WhatsApp answer is built from exactly what MCP returns
const viaMcp = await mcp('check_area_safety', { latitude: -33.97, longitude: 18.598, radius_km: 2, period_days: 90, location_name: 'Cape Town International Airport' })
const viaWa = await api.tool('check_area_safety', { latitude: -33.97, longitude: 18.598, radius_km: 2, period_days: 90, location_name: 'Cape Town International Airport' })
const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (['generated_at', 'from', 'to'].includes(k) ? undefined : v)))
assert.deepEqual(strip(viaWa), strip(viaMcp), 'WhatsApp and MCP read the same records')
for (const s of viaMcp.data.reports.filter((x) => x.verification_status === 'verified').map((x) => x.summary).slice(0, 2)) assert.ok(r[0].text.includes(s.slice(0, 40)), 'verified summary shown verbatim')

r = await say('Is there a reported issue on the route from the airport to Sea Point?')
assert.match(r[0].text, /🛣️ \*Cape Town International Airport → Sea Point\*/)
assert.match(r[0].text, /straight line[\s\S]*cannot guarantee/i)
r = await say('Is there a reported issue along my route?')
assert.equal(session.state, 'ROUTE_FROM')
await say('V&A Waterfront'); r = await say('Camps Bay')
assert.match(r[0].text, /V&A Waterfront → Camps Bay/)
r = await say('Can you check this transport company?')
assert.equal(session.state, 'PROVIDER_QUERY')
r = await say('Table Bay Executive Cars')
assert.match(r[0].text, /Under review, NOT approved/)
r = await say('How can I verify my accommodation?')
assert.equal(session.state, 'ACCOM_QUERY')
r = await say('Quayside Grand +27 21 000 0202')
assert.match(r[0].text, /matches the official number/)
r = await say('What should I do if my driver is asking for extra money?')
assert.equal(session.state, 'GUIDANCE_NEXT')
assert.match(r[0].text, /Unexpected request for extra payment[\s\S]*do not pay unexpected cash/)
r = await say('Can you explain how the verification process works?')
assert.match(r[0].text, /driver must say your code first/)
r = await say('I want to speak to someone.')
assert.match(r[0].text, /A person can help[\s\S]*Saltwater Lodge/)
r = await say('any current alerts?')
assert.match(r[0].text, /Current SafeArrival alerts[\s\S]*SAFETY ADVISORY/)
assert.doesNotMatch(r[0].text, /UNVERIFIED REPORT/, 'alerts list verified items only')
r = await say('where should I meet my driver at the pickup point?')
assert.match(r[0].text, /How to check your driver/)
r = await say('purple monkey dishwasher')
assert.match(r[0].text, /Could you say a little more/, 'clarifies unclear requests')
r = await say({ location: { lat: -33.905, lng: 18.419, name: 'Waterfront pin' } })
assert.match(r[0].text, /Waterfront pin/, 'shared WhatsApp location works anywhere')

// alerts need explicit consent
r = await say('please send me alerts for the V&A Waterfront')
assert.equal(session.state, 'ALERT_CONSENT')
assert.match(r.at(-1).text, /only incidents verified[\s\S]*never unverified/)
const subsBefore = (await db.query(`select count(*)::int n from alert_subscriptions`)).rows[0].n
r = await say({ id: 'alert:no' })
assert.equal((await db.query(`select count(*)::int n from alert_subscriptions`)).rows[0].n, subsBefore, 'no consent → no subscription')
await say('send me alerts for the V&A Waterfront'); r = await say({ id: 'alert:yes' })
assert.match(r[0].text, /Alerts set up for \*V&A Waterfront\*[\s\S]*\/alerts\/[0-9a-f]{20,}/)
const [sub] = (await db.query(`select source, channel, whatsapp, consent_text from alert_subscriptions order by created_at desc limit 1`)).rows
assert.deepEqual([sub.source, sub.channel, sub.whatsapp], ['whatsapp', 'whatsapp', '+27820000001'])
assert.match(sub.consent_text, /via SafeArrival WhatsApp/)
r = await say('stop alerts')
assert.match(r[0].text, /stopped/)
assert.equal((await db.query(`select status, whatsapp from alert_subscriptions order by created_at desc limit 1`)).rows[0].whatsapp, null)

// ================================================================ CTT source of truth: admin changes show on both channels
const [adv] = await as(U.admin, `select id from incidents where verification_status = 'official_advisory' limit 1`)
await rpc(U.admin, 'set_incident_verification', { p_incident: adv.id, p_status: 'rejected', p_summary: null })
r = await say('what about the airport area?')
assert.doesNotMatch(r[0].text, /SAFETY ADVISORY/, 'rejected advisory disappears from WhatsApp')
assert.equal((await mcp('check_area_safety', { latitude: -33.97, longitude: 18.598 })).data.summary.safety_advisories, 0, '…and from MCP')
await rpc(U.admin, 'set_incident_verification', { p_incident: adv.id, p_status: 'official_advisory', p_summary: 'Unofficial drivers approach arrivals inside the terminal. Demo advisory.', p_public_days: 1 })
await db.query(`update incidents set public_until = now() - interval '1 hour' where id = $1`, [adv.id])
r = await say('what about the airport area?')
assert.match(r[0].text, /EXPIRED, historical only/, 'expired advisory not presented as current')
r = await say('any alerts?')
assert.doesNotMatch(r[0].text, /Unofficial drivers approach/, 'expired advisory not in current alerts')

// ================================================================ incidents: conversational report, confirmation, idempotency
session = { state: 'MENU', ctx: { phone: '+27820000002' } }
r = await say('Someone at the airport is asking me to pay an extra airport fee.')
assert.match(all(r), /Unexpected request for extra payment[\s\S]*do not pay unexpected cash/, 'guidance first')
assert.equal(session.state, 'INCIDENT_LOCATION', 'description taken from the message; next question only')
r = await say('Is Sea Point safe?') // a question mid-report: answered, draft kept
assert.match(r[0].text, /\*Sea Point\*/)
assert.equal(session.ctx.paused.state, 'INCIDENT_LOCATION')
assert.match(all(r), /unfinished report/)
r = await say({ id: 'resume' })
assert.equal(session.state, 'INCIDENT_LOCATION')
await say('International Arrivals pickup area')
r = await say('yes I am safe')
assert.equal(session.state, 'INCIDENT_CONFIRM')
assert.match(r.at(-1).text, /Unexpected request for extra payment[\s\S]*International Arrivals[\s\S]*airport fee/)
const n0 = (await db.query(`select count(*)::int n from incidents`)).rows[0].n
const confirmCtx = session
r = await say({ id: 'submit' })
assert.match(r[0].text, /Reference: \*SAFE-\d{4}-\d{4}\*/)
const tok = session.ctx.lastIncidentToken
session = confirmCtx; await say({ id: 'submit' }) // double tap / webhook retry with the same draft
assert.equal((await db.query(`select count(*)::int n from incidents`)).rows[0].n, n0 + 1, 'idempotent: one case')
const [inc] = await as(U.admin, `select id, reference, category, priority, status, contact_whatsapp, visitor_safe, location_text, service from incidents where access_token = $1`, [tok])
assert.deepEqual([inc.category, inc.priority, inc.status, inc.contact_whatsapp, inc.visitor_safe, inc.service], ['extra_payment', 'standard', 'received', '+27820000002', true, 'transport'])

// contact is only accepted from the webhook (service role), never from anonymous callers
const anonRep = await rpc(null, 'report_incident', { p: JSON.stringify({ category: 'other', description: 'test', contact_whatsapp: '+27820000099' }) })
assert.equal((await as(U.admin, `select contact_whatsapp from incidents where reference = $1`, [anonRep.reference]))[0].contact_whatsapp, null)

// priorities: suggested, raised automatically, never lowered automatically
const pri = async (p) => (await as(U.admin, `select priority from incidents where reference = $1`, [(await asService('report_incident', { p: JSON.stringify(p) })).reference]))[0].priority
assert.equal(await pri({ category: 'intimidation' }), 'urgent')
assert.equal(await pri({ category: 'other', needs_immediate_help: true }), 'critical')
assert.equal(await pri({ category: 'medical_emergency' }), 'critical')
assert.equal(await pri({ category: 'listing_mismatch' }), 'standard')

// emergency first, then optional recording; never claims dispatch
session = { state: 'MENU', ctx: { phone: '+27820000003' } }
r = await say('help me, a man is following me with a knife')
assert.match(r[0].text, /10111[\s\S]*10177[\s\S]*112[\s\S]*cannot send police/)
assert.doesNotMatch(all(r), /(police|ambulance) (has|have) been (contacted|dispatched|called)/i)
r = await say({ id: 'emg:report' })
assert.equal(session.state, 'INCIDENT_LOCATION')
await say({ id: 'skip' })
r = await say({ id: 'submit' })
const [emg] = await as(U.admin, `select priority, needs_immediate_help, category from incidents where access_token = $1`, [session.ctx.lastIncidentToken])
assert.deepEqual([emg.priority, emg.needs_immediate_help, emg.category], ['critical', true, 'personal_safety'])
r = await say('I feel unsafe') // emergency words in a typing state still give numbers first
session = { state: 'INCIDENT_DESCRIPTION', ctx: { report: { key: 'k1', service: 'general', category: 'personal_safety' } } }
r = await say('there is danger outside my room')
assert.match(r[0].text, /10111/)
assert.equal(session.state, 'INCIDENT_LOCATION', 'and the description is still kept')

// ================================================================ case management (admin) + visitor follow-up
await assert.rejects(rpc(U.hotel1, 'set_incident_priority', { p_incident: inc.id, p_priority: 'urgent', p_reason: 'x' }), /safety team|admin|permission/i)
await assert.rejects(rpc(null, 'set_incident_priority', { p_incident: inc.id, p_priority: 'urgent', p_reason: 'xyz' }), /permission denied/)
await rpc(U.admin, 'set_incident_priority', { p_incident: inc.id, p_priority: 'urgent', p_reason: 'Active transaction at arrivals' })
await rpc(U.admin, 'assign_incident_handler', { p_incident: inc.id, p_handler: U.admin })
let [c] = await as(U.admin, `select status, priority, priority_source, handler_id from incidents where id = $1`, [inc.id])
assert.deepEqual([c.status, c.priority, c.priority_source, c.handler_id], ['assigned', 'urgent', 'admin', U.admin])
// (read as the database owner: by RLS design, staff never see tourist WhatsApp rows)
const outbox = async () => (await db.query(`select kind, body, delivery_status from notifications where incident_id = $1 and channel = 'whatsapp' order by created_at`, [inc.id])).rows
assert.match((await outbox()).at(-1).body, /safety team is now handling/, 'visitor without a booking is notified')
await rpc(U.admin, 'update_incident', { p_incident: inc.id, p_status: null, p_message: 'Called the airport operator; internal only.', p_public: false })
await rpc(U.admin, 'update_incident', { p_incident: inc.id, p_status: 'awaiting_visitor', p_message: 'What time did this happen?', p_public: true })
assert.equal((await outbox()).at(-1).kind, 'incident_info_request')
await rpc(U.admin, 'escalate_incident', { p_incident: inc.id, p_to: 'Airport operator security', p_message: 'Your report was passed to airport security.' })
;[c] = await as(U.admin, `select status, escalated_to from incidents where id = $1`, [inc.id])
assert.deepEqual([c.status, c.escalated_to], ['escalated', 'Airport operator security'])
await assert.rejects(rpc(U.admin, 'update_incident', { p_incident: inc.id, p_status: 'awaiting_visitor', p_message: 'x y z', p_public: false }), /must be shared/)

// the visitor follows up in WhatsApp: same case, no duplicates; internal notes never visible
session = { state: 'MENU', ctx: { phone: '+27820000002', lastIncidentToken: tok, incidentTokens: [tok] } }
r = await say('has there been an update?')
assert.match(r[0].text, /Escalated[\s\S]*airport security/)
assert.doesNotMatch(r[0].text, /internal only|Airport operator security|Priority/, 'internal notes stay internal')
assert.equal(session.state, 'REPORT_FOLLOWUP')
await say({ id: 'fu:info' }); r = await say('It happened around 14:00 near door 3.')
assert.match(r[0].text, /added to report/)
r = await say('I am safe now')
assert.match(r[0].text, /safe[\s\S]*stays open/)
;[c] = await as(U.admin, `select status, visitor_safe, (select count(*)::int from incidents i2 where i2.contact_whatsapp = '+27820000002') n from incidents where id = $1`, [inc.id])
assert.deepEqual([c.visitor_safe, c.n], [true, 1], 'follow-ups update the original case')
const pub = await rpc(null, 'get_incident', { p_token: tok })
assert.ok(!JSON.stringify(pub).includes('internal only') && !JSON.stringify(pub).includes('14:00'), 'visitor view has no internal notes')
const internal = await as(U.admin, `select message from incident_updates where incident_id = $1 and visibility = 'internal'`, [inc.id])
assert.ok(internal.some((u) => /14:00/.test(u.message)) && internal.some((u) => /Escalated to: Airport operator security/.test(u.message)))
await rpc(U.admin, 'update_incident', { p_incident: inc.id, p_status: 'resolved', p_message: 'Airport security removed the tout.' })
await rpc(U.admin, 'update_incident', { p_incident: inc.id, p_status: 'closed', p_message: 'Closed by the safety team.' })
;[c] = await as(U.admin, `select resolution from incidents where id = $1`, [inc.id])
assert.equal(c.resolution, 'Airport security removed the tout.')
await assert.rejects(rpc(null, 'incident_followup', { p_token: tok, p_kind: 'info', p_message: 'more' }), /closed/)
await assert.rejects(rpc(null, 'incident_followup', { p_token: 'f'.repeat(36), p_kind: 'safe' }), /not found/)
await assert.rejects(rpc(U.hotel1, 'update_incident', { p_incident: inc.id, p_status: 'triage', p_message: 'abc' }), /./)

// ================================================================ security
await assert.rejects(as(null, `select * from whatsapp_inbound`), /permission denied/)
await assert.rejects(as(null, `select private.run_tool('check_area_safety', '{}', 'x', 'y')`), /permission denied/)
assert.equal((await mcp('check_area_safety', {})).ok, false)
assert.equal((await rpc(null, 'mcp_call', { p_tool: 'check_area_safety', p_args: '{}' })).code, 'unauthorised', 'MCP secret still required')
const vd = await api.tool('verify_driver', { booking_token: 'nope' })
assert.equal(vd.ok, false, 'driver checks still need a booking token')
const wa = await api.tool('check_area_safety', { latitude: -33.97, longitude: 18.598 })
assert.doesNotMatch(JSON.stringify(wa), /\+27 ?8|contact_whatsapp|access_token|A man at the pickup/, 'no private data in public results')
const logged = await as(U.admin, `select client_name, count(*)::int n from mcp_requests group by 1`)
assert.ok(logged.some((x) => x.client_name === 'whatsapp' && x.n > 0), 'WhatsApp tool calls measured like MCP calls')
assert.ok(!(await db.query(`select client from private.mcp_rate`)).rows.some((x) => x.client.includes('2782')), 'phone numbers are hashed in rate-limit buckets')
for (let i = 0; i < 3; i++) await rpc(null, 'assistant_tool', { p_tool: 'subscribe_safety_alerts', p_args: JSON.stringify({ consent: true, latitude: -33.9, longitude: 18.42, location_name: 'Test', channel: 'web' }), p_client: 'flooder' })
assert.equal((await rpc(null, 'assistant_tool', { p_tool: 'subscribe_safety_alerts', p_args: JSON.stringify({ consent: true, latitude: -33.9, longitude: 18.42, location_name: 'Test', channel: 'web' }), p_client: 'flooder' })).code, 'rate_limited')

console.log('✓ WhatsApp intelligence: intents, menu + free text, MCP parity, classification + dates, admin changes on both channels, expiry, alert consent, conversational reports, confirmation, idempotency, priority, emergency, case lifecycle, follow-ups, internal notes private, security')
