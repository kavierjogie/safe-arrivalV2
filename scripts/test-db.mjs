// End-to-end check of the SQL backend: runs every migration + seed in PGlite
// (real Postgres), then walks both demo scenarios as the real roles.
// Run: npm run test:db
import assert from 'node:assert/strict'
import { db, U, as, rpc } from './pg.mjs'

const fails = async (p, re) => { await assert.rejects(p, re) }

// ---- seed sanity + RLS
const [{ n: hotelsAnon }] = await as(null, 'select count(*)::int n from hotels')
assert.equal(hotelsAnon, 3, 'anon sees only active hotels')
assert.equal((await as(null, 'select * from bookings')).length, 0, 'anon cannot list bookings')
assert.equal((await as(null, 'select * from drivers')).length, 0, 'anon cannot see drivers')
await fails(as(null, 'select * from verification_codes'), /permission denied/)
await fails(as(U.admin, 'select * from verification_codes'), /permission denied/)
await fails(as(U.hotel1, 'select * from booking_tokens'), /permission denied/)
await fails(as(U.hotel1, `update bookings set status = 'completed'`), /permission denied/)
const h1Bookings = await as(U.hotel1, 'select distinct hotel_id from bookings')
assert.deepEqual(h1Bookings.map((r) => r.hotel_id), ['a0000000-0000-4000-8000-000000000001'], 'hotel staff see only their hotel')
const shuttleProviders = await as(U.shuttle, 'select distinct provider_id from bookings')
assert.deepEqual(shuttleProviders.map((r) => r.provider_id), ['b0000000-0000-4000-8000-000000000002'], 'provider sees only own bookings')
const michaelTrips = await as(U.michael, 'select * from bookings')
assert.ok(michaelTrips.every((b) => b.provider_id === 'b0000000-0000-4000-8000-000000000001'), 'driver sees only assigned trips')
const notesH1 = await as(U.hotel1, 'select distinct recipient_type from notifications')
assert.ok(notesH1.every((r) => r.recipient_type === 'hotel'), 'hotel cannot read tourist/driver WhatsApp messages (codes)')
const adminMsgs = await as(U.admin, `select count(*)::int n from notifications where recipient_type in ('tourist','driver')`)
assert.equal(adminMsgs[0].n, 0, 'admin cannot read code-bearing messages')

// ---- Scenario 1: Sarah books hotel transport, hotel confirms + assigns Michael, she verifies.
const opt = (await as(null, `select id from hotel_transport_partners where hotel_id = 'a0000000-0000-4000-8000-000000000001' and vehicle_class = 'Sedan'`))[0].id
const pickup = new Date(Date.now() + 2 * 3600e3).toISOString()
await fails(rpc(null, 'create_booking', { p: JSON.stringify({ full_name: 'S', whatsapp: '123' }) }), /name/)
const created = await rpc(null, 'create_booking', { p: JSON.stringify({ full_name: 'Sarah Mitchell', whatsapp: '+44 7700 900123', hotel_slug: 'hotel-001',
  partner_id: opt, pickup_point_id: 'cpt-intl', pickup_at: pickup, passengers: 2, luggage: 2, flight_number: 'ba 59', source: 'email_link' }) })
assert.match(created.reference, /^CT-TRIP-\d{4}-\d{3}$/)
assert.equal(created.status, 'pending')
const tok = created.access_token
let trip = await rpc(null, 'get_trip', { p_token: tok })
assert.equal(trip.booking.flight_number, 'BA59')
assert.equal(trip.booking.access_token, undefined, 'token not echoed')
assert.equal(trip.driver, null)

const bid = trip.booking.id
await fails(rpc(U.hotel2, 'confirm_booking', { p_booking: bid }), /Not authorised/)
await fails(rpc(U.hotel1, 'assign_driver', { p_booking: bid, p_driver: 'c0000000-0000-4000-8000-000000000001', p_vehicle: 'd0000000-0000-4000-8000-000000000001' }), /confirmed/)
await rpc(U.hotel1, 'confirm_booking', { p_booking: bid })
await fails(rpc(U.hotel1, 'assign_driver', { p_booking: bid, p_driver: 'c0000000-0000-4000-8000-000000000002', p_vehicle: 'd0000000-0000-4000-8000-000000000002' }), /provider/)
const assigned = await rpc(U.hotel1, 'assign_driver', { p_booking: bid, p_driver: 'c0000000-0000-4000-8000-000000000001', p_vehicle: 'd0000000-0000-4000-8000-000000000001' })
assert.equal(assigned.code, undefined, 'staff never receive the code')
trip = await rpc(null, 'get_trip', { p_token: tok })
assert.match(trip.code, /^[A-Z]+ [A-Z]+ \d{2}$/)
assert.equal(trip.driver.registration, 'CA 123-456')
assert.equal(trip.driver.phone, null, 'driver phone hidden until on the way')
const code = trip.code
const driverMsg = await as(U.michael, `select body from notifications where booking_id = $1 and recipient_type = 'driver'`, [bid])
assert.ok(driverMsg[0].body.includes(code), 'driver receives code on own channel')
const hash = await db.query(`select code_hash from verification_codes where booking_id = $1`, [bid])
assert.ok(!hash.rows[0].code_hash.includes(code) && hash.rows[0].code_hash.length === 64, 'only a hash is stored')

await fails(rpc(U.michael, 'update_trip_status', { p_booking: bid, p_status: 'in_progress', p_note: 'skip verification' }), /verify/)
await rpc(U.michael, 'update_trip_status', { p_booking: bid, p_status: 'driver_on_way' })
await rpc(U.michael, 'update_trip_status', { p_booking: bid, p_status: 'driver_arrived' })
trip = await rpc(null, 'get_trip', { p_token: tok })
assert.equal(trip.driver.phone, '+27 82 000 0101')
assert.equal((await rpc(null, 'check_spoken_code', { p_token: tok, p_code: 'RED KITE 11' })).match, false)
assert.equal((await rpc(null, 'check_spoken_code', { p_token: tok, p_code: code.toLowerCase().replace(/ /g, '-') })).match, true, 'spoken code check normalises')
await rpc(null, 'record_verification', { p_token: tok, p_outcome: 'verified' })
trip = await rpc(null, 'get_trip', { p_token: tok })
assert.equal(trip.booking.status, 'in_progress')
assert.equal(trip.code, null, 'code removed once used')
assert.equal(trip.code_status, 'used')
assert.ok(!trip.messages.some((m) => m.body.includes(code)), 'code redacted from message history')
await fails(rpc(null, 'record_verification', { p_token: tok, p_outcome: 'verified' }), /only possible/)
await rpc(U.michael, 'update_trip_status', { p_booking: bid, p_status: 'completed' })

// ---- Scenario 2: wrong vehicle → incident → hotel + provider alerted → updates reach tourist.
const created2 = await rpc(null, 'create_booking', { p: JSON.stringify({ full_name: 'Sarah Mitchell', whatsapp: '+447700900123', hotel_slug: 'hotel-001',
  partner_id: opt, pickup_point_id: 'cpt-intl', pickup_at: pickup, passengers: 2, luggage: 2 }) })
const b2 = (await rpc(null, 'get_trip', { p_token: created2.access_token })).booking.id
await rpc(U.hotel1, 'confirm_booking', { p_booking: b2 })
await rpc(U.hotel1, 'assign_driver', { p_booking: b2, p_driver: 'c0000000-0000-4000-8000-000000000001', p_vehicle: 'd0000000-0000-4000-8000-000000000001' })
await rpc(null, 'record_verification', { p_token: created2.access_token, p_outcome: 'wrong_vehicle' })
const inc = await rpc(null, 'report_incident', { p: JSON.stringify({ booking_token: created2.access_token, category: 'vehicle_mismatch',
  description: 'Man said he was my driver but the registration was CA 999-111', needs_immediate_help: false }) })
assert.match(inc.reference, /^SAFE-\d{4}-\d{4}$/)
assert.equal(inc.status, 'hotel_pending')
let tracked = await rpc(null, 'get_incident', { p_token: inc.access_token })
assert.deepEqual(tracked.updates.map((u) => u.status), ['received', 'provider_notified', 'hotel_notified', 'hotel_pending'])
const incId = (await as(U.hotel1, 'select id from incidents where reference = $1', [inc.reference]))[0].id
assert.ok(incId, 'hotel sees the incident')
assert.equal((await as(U.hotel2, 'select id from incidents where reference = $1', [inc.reference])).length, 0, 'other hotel does not')
await rpc(U.hotel1, 'update_incident', { p_incident: incId, p_status: 'follow_up', p_message: 'We have called you and sent our own driver Michael to you.', p_public: true })
await rpc(U.hotel1, 'update_incident', { p_incident: incId, p_status: null, p_message: 'Internal: check CCTV request', p_public: false })
await fails(rpc(U.hotel1, 'update_incident', { p_incident: incId, p_status: 'closed', p_message: 'done', p_public: true }), /safety team/)
await rpc(U.hotel1, 'set_police_reference', { p_incident: incId, p_case: 'CAS 101/11/2026', p_station: 'Bishop Lavis' })
tracked = await rpc(null, 'get_incident', { p_token: inc.access_token })
assert.ok(!tracked.updates.some((u) => u.message.startsWith('Internal')), 'internal notes hidden from tourist')
assert.equal(tracked.incident.police_case_number, 'CAS 101/11/2026')
const touristMsgs = (await rpc(null, 'get_trip', { p_token: created2.access_token })).messages.map((m) => m.kind)
assert.ok(touristMsgs.includes('incident_update'), 'tourist receives update message')
await rpc(U.admin, 'update_incident', { p_incident: incId, p_status: 'closed', p_message: 'Closed after follow-up.', p_public: true })
await rpc(U.hotel1, 'cancel_booking', { p_booking: b2, p_reason: 'Replaced after impersonation attempt' })
assert.equal((await rpc(null, 'get_trip', { p_token: created2.access_token })).code_status, 'revoked')

// ---- Admin + audit + reset
await fails(rpc(U.hotel1, 'set_partner_status', { p_kind: 'driver', p_id: 'c0000000-0000-4000-8000-000000000006', p_status: 'approved' }), /Administrator/)
await rpc(U.admin, 'set_partner_status', { p_kind: 'driver', p_id: 'c0000000-0000-4000-8000-000000000006', p_status: 'approved' })
assert.ok((await as(U.admin, 'select count(*)::int n from audit_logs'))[0].n > 3)
await fails(rpc(null, 'reset_demo'), /permission denied/) // anon has no EXECUTE at all (migration 9)
await rpc(U.admin, 'reset_demo')
assert.equal((await as(U.admin, `select count(*)::int n from bookings where status = 'pending'`))[0].n, 1)
assert.equal((await as(U.admin, `select count(*)::int n from profiles`))[0].n, 8)

console.log('✓ database checks passed: RLS, both demo scenarios, codes, incidents, admin, reset')
