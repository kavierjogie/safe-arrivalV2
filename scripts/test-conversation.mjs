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
assert.match(r[0].text, /Welcome to Cape Town/)
assert.equal(session.state, 'MENU')
r = await say({ text: 'blah' })
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
r = await say({ id: 'urgent:no' })
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

console.log('✓ conversation checks passed: booking, verification (typed + tapped), wrong vehicle incident, keywords, WhatsApp limits')
