// Accommodation checks, safety guidance, report status, the shared feedback service, admin
// feedback/analytics reports and goals (migration 11), against the real SQL on PGlite.
// Run: npm run test:feedback
import assert from 'node:assert/strict'
import { db, U, as, rpc } from './pg.mjs'

const SECRET = 'test-secret-'.padEnd(40, 'x')
await db.query(`select private.set_mcp_secret($1)`, [SECRET])
async function call(tool, args = {}, client = 'client-a') {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.headers', $1, true),
      set_config('search_path', 'public, extensions', true)`, [JSON.stringify({ 'x-mcp-secret': SECRET })])
    await tx.query('set local role anon')
    return (await tx.query('select public.mcp_call($1, $2, $3, $4) r', [tool, JSON.stringify(args), client, 'test-client'])).rows[0].r
  })
}
const ok = async (tool, args, client) => { const r = await call(tool, args, client); assert.equal(r.ok, true, `${tool}: ${r.error}`); return r.data }

// ---- check_accommodation: partner + contact consistency, not-in-records, logged as an MCP check
const acc = await ok('check_accommodation', { name: 'Saltwater', phone: '+27 21 000 0101' })
assert.equal(acc.matches[0].safearrival_status, 'approved_partner')
assert.equal(acc.matches[0].contact_check, 'match')
assert.equal(acc.result, 'verified_partner')
assert.match(acc.feedback.ref, /^[0-9a-f]{32}$/, 'feedback offered after an accommodation check')
const accBad = await ok('check_accommodation', { name: 'Saltwater', phone: '021 555 9999' })
assert.equal(accBad.result, 'contact_mismatch')
assert.ok(accBad.warnings.some((w) => /does NOT match/.test(w)))
const pend = await ok('check_accommodation', { name: 'Vineyard Hill', phone: '+27 21 000 0404' })
assert.equal(pend.matches[0].safearrival_status, 'under_review_not_approved')
assert.equal(pend.matches[0].official_contacts, null, 'no contacts for unapproved accommodation')
assert.equal(pend.matches[0].contact_check, 'no_official_number_on_record', 'never confirms numbers for unapproved accommodation')
assert.equal((await ok('check_accommodation', { name: 'Nowhere Guest Rooms' })).result, 'not_in_safearrival_records')
assert.equal((await call('check_accommodation', { name: 'ab' })).code, 'invalid')
const checks = await as(U.admin, `select outcome from safety_checks where not simulated and channel = 'mcp' and service = 'accommodation'`)
assert.deepEqual(checks.map((c) => c.outcome).sort(), ['contact_mismatch', 'not_approved', 'not_found', 'verified_partner'])
await ok('verify_transport_provider', { provider_name: 'trusted shuttle' })
assert.equal((await as(U.admin, `select count(*)::int n from safety_checks where not simulated and service = 'transport' and channel = 'mcp'`))[0].n, 1, 'provider checks logged')
await assert.rejects(as(null, 'select * from safety_checks'), /permission denied/)
assert.equal((await as(U.hotel1, 'select * from safety_checks')).length, 0, 'only admins read checks')

// ---- get_safety_guidance: approved content only, by stage and service
const g = await ok('get_safety_guidance', { stage: 'before_arrival', service: 'accommodation' })
assert.ok(g.advice.some((a) => /Suspicious booking requests/.test(a.title)))
assert.ok(g.advice.every((a) => ['accommodation', 'any'].includes(a.applies_to)))
assert.equal(g.emergency.police, '10111')
assert.equal((await call('get_safety_guidance', { stage: 'whenever' })).code, 'invalid')

// ---- report_safety_incident (accommodation) → get_incident_status → follow-up feedback
const rep = await ok('report_safety_incident', { category: 'booking_payment_fraud', subject_name: 'Saltwater Lodge',
  description: 'Message asked me to pay the deposit again to a new bank account', user_confirmed: true }, 'rep')
assert.equal(rep.service, 'accommodation')
assert.ok(rep.feedback?.ref, 'feedback offered after a (non-urgent) report')
const [row] = await as(U.admin, `select hotel_id, subject_hotel_id is not null as linked, source from incidents where reference = $1`, [rep.reference])
assert.deepEqual(row, { hotel_id: null, linked: true, source: 'ai_assistant_report' })
assert.equal((await as(U.hotel1, `select 1 from incidents where reference = $1`, [rep.reference])).length, 0, 'the reported accommodation cannot see it')
const urgent = await ok('report_safety_incident', { category: 'accommodation_unsafe', description: 'Someone is trying to get into my room', urgent: true, user_confirmed: true }, 'rep2')
assert.equal(urgent.feedback, null, 'never ask for feedback on an urgent report')
let st = await ok('get_incident_status', { tracking_token: rep.tracking_token })
assert.equal(st.reference, rep.reference)
assert.match(st.status_meaning, /Do not describe it as resolved/)
assert.equal(st.feedback, null, 'no follow-up feedback before a human has followed up')
assert.doesNotMatch(JSON.stringify(st), /bank account/, 'the raw description is not returned')
const incId = (await as(U.admin, `select id from incidents where reference = $1`, [rep.reference]))[0].id
await rpc(U.admin, 'update_incident', { p_incident: incId, p_status: 'follow_up', p_message: 'We contacted the accommodation on its official number.', p_public: true })
st = await ok('get_incident_status', { tracking_token: rep.tracking_token })
assert.equal(st.status, 'follow_up')
assert.ok(st.feedback?.ref, 'follow-up feedback offered once there is a human update')
assert.equal((await call('get_incident_status', { tracking_token: 'f'.repeat(36) })).code, 'not_found')
// transport reports keep their old routing
const tr = await ok('report_safety_incident', { category: 'extra_payment', description: 'Asked for R300 airport fee in cash', pickup_point_id: 'cpt-intl', user_confirmed: true }, 'rep3')
assert.equal(tr.service, 'transport')

// ---- submit_feedback: validation, one per ref, channel tracking, privacy
assert.equal((await call('submit_feedback', { ref: acc.feedback.ref })).code, 'invalid', 'nothing to submit')
assert.match((await call('submit_feedback', { ref: acc.feedback.ref, safety_rating: 9 })).error, /1 to 5/)
assert.match((await call('submit_feedback', { ref: acc.feedback.ref, answers: { driver_matched: 'yes' } })).error, /Unknown question/)
assert.match((await call('submit_feedback', { ref: 'a'.repeat(32), helpful: 'yes' })).error, /Unknown or expired/)
const sent = await ok('submit_feedback', { ref: acc.feedback.ref, helpful: 'yes', safety_rating: 4, answers: { provider_consistent: 'yes' }, comment: 'Useful\n\n check' })
assert.equal(sent.submitted, true)
assert.match((await call('submit_feedback', { ref: acc.feedback.ref, helpful: 'no' })).error, /already submitted/, 'duplicate prevented')
await ok('submit_feedback', { ref: st.feedback.ref, overall_rating: 2, answers: { received_update: 'yes', communication_ok: 'no' } })
const fbRows = await as(U.admin, `select service, channel, helpful, safety_rating, comment, hotel_id is not null as hotel, incident_id is not null as incident
  from feedback where submitted_at is not null and not simulated order by submitted_at`)
assert.deepEqual(fbRows, [
  { service: 'accommodation', channel: 'mcp', helpful: 'yes', safety_rating: 4, comment: 'Useful check', hotel: true, incident: false },
  { service: 'incident', channel: 'mcp', helpful: null, safety_rating: null, comment: null, hotel: false, incident: true },
])
await assert.rejects(as(null, 'select * from feedback'), /permission denied/)
await assert.rejects(as(U.admin, 'select ref from feedback'), /permission denied/, 'refs are never readable, even by admins')
assert.equal((await as(U.hotel1, 'select id from feedback')).length, 0, 'only admins read feedback')
await assert.rejects(as(null, `insert into feedback (service, channel) values ('guidance', 'mcp')`), /permission denied/)
// A WhatsApp ref cannot be used through MCP
const wa = await rpc(null, 'request_feedback', { p: JSON.stringify({ service: 'guidance' }) })
assert.match((await call('submit_feedback', { ref: wa.ref, helpful: 'yes' })).error, /another channel/)
// WhatsApp: one offer per booking; once submitted, no new offer
const [{ token: btok }] = (await db.query(`select t.token from booking_tokens t join bookings b on b.id = t.booking_id where b.status = 'completed' limit 1`)).rows
const o1 = await rpc(null, 'request_feedback', { p: JSON.stringify({ service: 'transport', booking_token: btok }) })
const o2 = await rpc(null, 'request_feedback', { p: JSON.stringify({ service: 'transport', booking_token: btok }) })
assert.equal(o1.ref, o2.ref, 'open offer reused')
await rpc(null, 'submit_feedback', { p: JSON.stringify({ ref: o1.ref, safety_rating: 5 }) })
assert.equal((await rpc(null, 'request_feedback', { p: JSON.stringify({ service: 'transport', booking_token: btok }) })).already_submitted, true)
await assert.rejects(rpc(null, 'request_feedback', { p: JSON.stringify({ service: 'transport', booking_token: 'nope'.padEnd(36, '0') }) }))

// ---- admin reports: admin-only, server-side, real vs simulated kept apart
await assert.rejects(rpc(U.hotel1, 'admin_feedback_report', { p: '{}' }), /Administrator/)
await assert.rejects(rpc(null, 'admin_goals', {}), /permission denied/)
const real = await rpc(U.admin, 'admin_feedback_report', { p: JSON.stringify({ data: 'real', channel: 'mcp' }) })
assert.equal(real.summary.submitted, 2)
assert.equal(real.summary.simulated, 0)
assert.equal(Number(real.summary.avg_safety), 4)
assert.equal(real.summary.negative, 1, 'overall 2 / "no" answer counts as negative')
assert.ok(real.rows.every((r) => !('ref' in r)))
const sim = await rpc(U.admin, 'admin_feedback_report', { p: JSON.stringify({ data: 'simulated' }) })
assert.ok(sim.summary.submitted > 20 && sim.summary.real === 0)
assert.ok(sim.recurring.length > 0, 'recurring complaints grouped by provider/accommodation')
const low = await rpc(U.admin, 'admin_feedback_report', { p: JSON.stringify({ service: 'accommodation', min_rating: 1, max_rating: 2 }) })
assert.ok(low.rows.length && low.rows.every((r) => r.service === 'accommodation' && (r.overall_rating ?? r.safety_rating) <= 2))
const byWa = await rpc(U.admin, 'admin_feedback_report', { p: JSON.stringify({ channel: 'whatsapp' }) })
assert.ok(byWa.rows.every((r) => r.channel === 'whatsapp'))
await rpc(U.admin, 'log_feedback_export', { p: JSON.stringify({ service: 'accommodation' }) })
const an = await rpc(U.admin, 'admin_safety_analytics', { p_days: 90 })
assert.ok(an.incidents_by_category.some((c) => c.service === 'accommodation'))
assert.ok(an.repeated_subjects.some((s) => s.service === 'accommodation'))
assert.ok(an.transport_verification.rate > 0)
assert.doesNotMatch(JSON.stringify(an), /bank account|\+44/, 'analytics carry no raw descriptions or phone numbers')

// ---- goals: configurable targets, KPIs computed in the database, audited
await assert.rejects(rpc(U.hotel1, 'save_goal', { p: '{}' }), /Administrator/)
const gid = await rpc(U.admin, 'save_goal', { p: JSON.stringify({ name: 'Visitors feel safe (real)', category: 'overall', kpi: 'avg_safety_rating',
  baseline: 3, target: 4.5, period_start: '2026-01-01', period_end: '2026-12-31' }) })
const goalOf = async (sim) => (await rpc(U.admin, 'admin_goals', { p_include_simulated: sim })).goals.find((x) => x.id === gid)
let mine = await goalOf(false)
assert.equal(Number(mine.current), 4.5, 'real data only: ratings 4 (MCP) and 5 (WhatsApp)')
assert.equal(mine.status, 'achieved')
assert.notEqual(Number((await goalOf(true)).current), 4.5, 'simulated data changes the value only when included')
await assert.rejects(rpc(U.admin, 'save_goal', { p: JSON.stringify({ name: 'Bad', category: 'overall', kpi: 'avg_safety_rating', baseline: 3, target: 3,
  period_start: '2026-01-01', period_end: '2026-12-31' }) }), /target different/)
await rpc(U.admin, 'save_goal', { p: JSON.stringify({ id: gid, name: 'Acknowledge transport incidents faster', category: 'transport', kpi: 'incident_ack_minutes',
  baseline: 60, target: 20, period_start: '2026-01-01', period_end: '2026-12-31' }) })
mine = await goalOf(false)
assert.equal(mine.lower_is_better, true)
assert.ok(Number(mine.current) > 0 && ['achieved', 'on_track', 'at_risk'].includes(mine.status))
await rpc(U.admin, 'delete_goal', { p_id: gid })
assert.deepEqual((await as(U.admin, `select action from audit_logs where entity in ('goal', 'feedback') order by created_at`)).map((a) => a.action),
  ['export_feedback', 'create_goal', 'update_goal', 'delete_goal'])
assert.ok((await rpc(U.admin, 'admin_goals', {})).goals.length >= 5, 'starting goals are seeded, not hard-coded')

// ---- reset keeps simulated data flagged, wipes real feedback
await rpc(U.admin, 'reset_demo')
assert.equal((await as(U.admin, `select count(*)::int n from feedback where not simulated`))[0].n, 0)
assert.ok((await as(U.admin, `select count(*)::int n from feedback where simulated`))[0].n > 0)

console.log('✓ accommodation checks, guidance, report status, feedback (validation, duplicates, channels, privacy), admin reports, analytics, goals')
