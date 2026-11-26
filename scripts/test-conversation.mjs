// Drives the WhatsApp conversation engine through both demo scenarios against
// the real SQL backend, exactly as the webhook would. Run: npm run test:chat
import assert from 'node:assert/strict'
import { U, as, rpc } from './pg.mjs'
import { handle } from '../supabase/functions/_shared/conversation.js'

const api = {
  hotels: () => as(null, `select slug, name, area, phone from hotels order by name`),
  pickupPoints: () => as(null, `select * from pickup_points order by kind, name`),
  options: (slug) => as(null, `select o.*, p.name as provider_name from hotel_transport_partners o join hotels h on h.id = o.hotel_id
    join transport_providers p on p.id = o.provider_id where h.slug = $1 and o.available order by o.price_amount nulls last`, [slug]),
  createBooking: (p) => rpc(null, 'create_booking', { p: JSON.stringify(p) }),
  getTrip: (t) => rpc(null, 'get_trip', { p_token: t }),
  recordVerification: (t, o) => rpc(null, 'record_verification', { p_token: t, p_outcome: o }),
  checkCode: (t, c) => rpc(null, 'check_spoken_code', { p_token: t, p_code: c }),
  reportIncident: (p) => rpc(null, 'report_incident', { p: JSON.stringify(p) }),
  checkAccommodation: (p) => rpc(null, 'check_accommodation', { p: JSON.stringify(p) }),
  checkProvider: (p) => rpc(null, 'check_transport_provider', { p: JSON.stringify(p) }),
  getIncident: (t) => rpc(null, 'get_incident', { p_token: t }),
  guidance: (stage) => rpc(null, 'safety_guidance', { p_stage: stage }),
  requestFeedback: (p) => rpc(null, 'request_feedback', { p: JSON.stringify(p) }),
  submitFeedback: (p) => rpc(null, 'submit_feedback', { p: JSON.stringify(p) }),
  tool: (name, args) => rpc(null, 'assistant_tool', { p_tool: name, p_args: JSON.stringify(args), p_client: 'test-visitor' }),
  resolvePlace: (q) => rpc(null, 'resolve_place', { p_query: q }),
  categoryInfo: (c) => rpc(null, 'incident_category_info', { p_category: c }),
  followup: (t, kind, msg) => rpc(null, 'incident_followup', { p_token: t, p_kind: kind, p_message: msg }),
  tripLink: (t) => `https://example.test/trip/${t}`,
  incidentLink: (t) => `https://example.test/incident/${t}`,
  statusLabel: (s) => s, fmtTime: (d) => String(d), priceText: () => 'R450',
}

let session = { state: 'WELCOME', ctx: { hotelSlug: 'hotel-001', hotelName: 'Saltwater Lodge', profileName: 'Sarah Mitchell', phone: '+447700900123' } }
const say = async (input) => {
  const r = await handle(session, input, api)
  session = r.session
  for (const m of r.replies) {
    if (m.type === 'buttons') assert.ok(m.buttons.length <= 3 && m.buttons.every((b) => b.title.length <= 20), 'WhatsApp button limits')
    if (m.type === 'list') assert.ok(m.rows.length <= 10 && m.rows.every((x) => x.title.length <= 24), 'WhatsApp list limits')
  }
  return r.replies
}
const last = (rs) => rs.at(-1)

let r = await say({ text: 'hi' })
assert.match(r[0].text, /Welcome to SafeArrival/)
assert.equal(session.state, 'MENU')
r = await say({ text: 'blah blah' })
assert.match(r[0].text, /didn’t understand/)
r = await say({ id: 'arrange' })
assert.equal(session.state, 'PICKUP')
r = await say({ id: 'pickup:cpt-intl' })
r = await say({ id: 'day:0' })
r = await say({ text: '25:99' })
assert.equal(session.state, 'ARRIVAL_TIME')
r = await say({ text: '23:50' })
assert.equal(session.state, 'PASSENGERS')
await say({ id: 'pax:2' })
await say({ id: 'bags:2' })
assert.equal(session.state, 'NAME')
r = await say({ id: 'name:profile' })
assert.equal(session.state, 'TRANSPORT_SELECTION')
const hotelOpt = last(r).rows.find((x) => 'Saltwater Lodge Transfers'.startsWith(x.title))
assert.ok(hotelOpt, 'hotel option listed')
r = await say({ id: hotelOpt.id })
assert.match(last(r).text, /R450 agreed price/)
r = await say({ id: 'confirm' })
assert.match(r[0].text, /CT-TRIP-\d{4}-\d{3}/)
assert.equal(session.state, 'BOOKED')
const tok = session.ctx.bookingToken

r = await say({ id: 'verify' })
assert.match(r[0].text, /hasn’t been assigned/)

// Hotel confirms + assigns Michael (Scenario 1)
const bid = (await rpc(null, 'get_trip', { p_token: tok })).booking.id
await rpc(U.hotel1, 'confirm_booking', { p_booking: bid })
await rpc(U.hotel1, 'assign_driver', { p_booking: bid, p_driver: 'c0000000-0000-4000-8000-000000000001', p_vehicle: 'd0000000-0000-4000-8000-000000000001' })
r = await say({ id: 'verify' })
assert.equal(session.state, 'VERIFICATION')
r = await say({ text: 'purple rocket 12' })
assert.match(r[0].text, /does NOT match/)
assert.equal(session.state, 'VERIFY_MORE')

// Scenario 2: wrong vehicle → incident
r = await say({ id: 'v:wrong_vehicle' })
assert.match(r[0].text, /Do not enter the vehicle/)
assert.equal(session.state, 'INCIDENT_DESCRIPTION')
r = await say({ text: 'Registration was CA 999-111, not CA 123-456' })
assert.equal(session.state, 'INCIDENT_URGENT', 'pickup location already known from the booking')
r = await say({ id: 'urgent:no' })
assert.equal(session.state, 'INCIDENT_CONFIRM', 'never submitted without confirmation')
assert.match(last(r).text, /Vehicle did not match[\s\S]*International Arrivals[\s\S]*CA 999-111/)
r = await say({ id: 'submit' })
assert.match(r[0].text, /SAFE-\d{4}-\d{4}/)
assert.match(r[0].text, /not a police case number/)
const inc = await rpc(null, 'get_incident', { p_token: session.ctx.lastIncidentToken })
assert.equal(inc.incident.category, 'vehicle_mismatch')

// Real driver arrives; code typed then confirmed.
const code = (await rpc(null, 'get_trip', { p_token: tok })).code
await say({ id: 'verify' })
r = await say({ text: code.toLowerCase() })
assert.match(r[0].text, /matches your code/)
r = await say({ id: 'v:verified' })
assert.equal(session.state, 'COMPLETED')
assert.equal((await rpc(null, 'get_trip', { p_token: tok })).booking.status, 'in_progress')

r = await say({ text: 'I need to speak to a person' })
assert.match(r[0].text, /front desk/)
r = await say({ text: 'emergency' })
assert.match(r[0].text, /10111/)

// ---- After a verified pickup: transport feedback (safety rating first), once only.
const feedbackRows = () => as(U.admin, `select service, channel, safety_rating, overall_rating, helpful, confident, answers, comment, submitted_at from feedback where not simulated order by requested_at`)
r = await say({ id: 'menu' })
r = await say({ id: 'feedback' })
assert.match(r.at(-1).text, /How safe did you feel during your pickup/)
assert.ok(r.at(-1).rows.some((x) => x.title === 'Very unsafe') && r.at(-1).rows.some((x) => x.id === 'fb:later'), 'five-point safety scale + Not now')
await say({ id: 'fb:5' })
await say({ id: 'fb:yes' })
await say({ text: 'partly' }) // typed answers work too
await say({ id: 'fb:yes' })
r = await say({ text: 'Code check made me feel calm. hi' }) // keywords inside a comment are not commands
assert.match(r[0].text, /Thank you for your feedback/)
let fbs = await feedbackRows()
assert.equal(fbs.length, 1)
assert.deepEqual([fbs[0].service, fbs[0].channel, fbs[0].safety_rating, fbs[0].confident], ['transport', 'whatsapp', 5, 'yes'])
assert.deepEqual(fbs[0].answers, { driver_matched: 'yes', price_respected: 'partly' })
assert.match(fbs[0].comment, /calm/)
r = await say({ id: 'feedback' })
r = await say({ id: 'fbk:pickup' })
assert.match(r[0].text, /already given feedback/, 'one feedback per booking')

// ---- Accommodation check with a phone number that does not match → report (safety team only).
session.ctx.lastAskedAt = Date.now() - 13 * 3600e3 // a day later: asking again is allowed
r = await say({ id: 'menu' })
r = await say({ id: 'accom' })
assert.equal(session.state, 'ACCOM_QUERY')
r = await say({ text: 'Saltwater Lodge +27 21 999 1234' })
assert.match(r[0].text, /SafeArrival partner/)
assert.match(r[0].text, /does \*NOT\* match/)
assert.equal(session.state, 'CHECK_DONE')
r = await say({ id: 'report' })
assert.ok(last(r).rows.some((x) => x.id === 'cat:host_identity_mismatch'), 'accommodation categories')
await say({ id: 'cat:host_identity_mismatch' })
await say({ text: 'A WhatsApp number claiming to be the lodge asked for a deposit' })
assert.equal(session.state, 'INCIDENT_LOCATION')
await say({ id: 'skip' })
await say({ id: 'urgent:no' })
r = await say({ id: 'submit' })
assert.match(r[0].text, /safety team will review/)
assert.equal(session.state, 'FEEDBACK_ASK', 'feedback offered after a report')
const accTok = session.ctx.lastIncidentToken
const accRef = (await rpc(null, 'get_incident', { p_token: accTok })).incident.reference
const [accInc] = await as(U.admin, `select service, hotel_id, subject_name, subject_hotel_id is not null as linked from incidents where reference = $1`, [accRef])
assert.deepEqual(accInc, { service: 'accommodation', hotel_id: null, subject_name: 'Saltwater Lodge', linked: true })
assert.equal((await as(U.hotel1, `select id from incidents where reference = $1`, [accRef])).length, 0, 'the accommodation reported never sees the report')
r = await say({ id: 'fb:later' })
assert.match(r[0].text, /No problem/)
r = await say({ text: 'hi' })
assert.match(r[0].text, /still tell us how your report went/, 'pending feedback offered in the next conversation')

// ---- Unknown accommodation, transport company check, report status, safety tips (no repeat ask within 12h).
r = await say({ id: 'accom' })
r = await say({ text: 'Totally Unknown Guest Rooms' })
assert.match(r[0].text, /no record/)
r = await say({ id: 'menu' })
r = await say({ id: 'provider' })
r = await say({ text: 'trusted shuttle' })
assert.match(r[0].text, /\*Cape Town Trusted Shuttle\* — ✅ SafeArrival partner/)
r = await say({ id: 'menu' })
r = await say({ id: 'status' })
assert.match(r[0].text, /\*SAFE-\d{4}-\d{4}\* — Received/)
assert.match(r[0].text, /not police case numbers/)
r = await say({ id: 'menu' })
r = await say({ id: 'tips' })
r = await say({ id: 'tips:before_arrival' })
assert.match(r[0].text, /Suspicious booking requests/)
assert.equal(session.state, 'BOOKED', 'no second feedback ask within 12 hours')
r = await say({ id: 'fb:start' }) // the pending offer is now the safety tips
r = await say({ id: 'fb:4' })
await say({ id: 'fb:yes' })
await say({ id: 'fb:partly' })
r = await say({ id: 'fb:skip' })
fbs = await feedbackRows()
assert.deepEqual(fbs.filter((f) => f.submitted_at).map((f) => f.service).sort(), ['guidance', 'transport'])
assert.equal(fbs.find((f) => f.service === 'guidance').overall_rating, 4)

console.log('✓ conversation checks passed: booking, verification (typed + tapped), wrong vehicle incident, keywords, WhatsApp limits, accommodation + provider checks, accommodation report, report status, safety tips, feedback (dedupe, pending, no nagging)')
