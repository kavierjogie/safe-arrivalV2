// WhatsApp conversation engine — shared by the web simulator (src/) and the
// production webhook (supabase/functions/whatsapp-webhook). Pure JavaScript,
// no imports, so it runs in the browser and in Deno.
//
//   handle(session, input, api) → { session, replies }
//
// session: { state, ctx }   input: { text } | { id }  (id = tapped button/list row)
// replies use only shapes WhatsApp supports:
//   { type: 'text', text }
//   { type: 'buttons', text, buttons: [{ id, title }] }          ≤3 buttons, title ≤20 chars
//   { type: 'list', text, button, rows: [{ id, title, description }] }  ≤10 rows, title ≤24 chars
//
// api (injected): hotels(), pickupPoints(), options(hotelSlug), createBooking(p), getTrip(token),
//   recordVerification(token, outcome), checkCode(token, code), reportIncident(p),
//   checkAccommodation(p), checkProvider(p), getIncident(token), guidance(stage),
//   requestFeedback(p), submitFeedback(p), tripLink(token), incidentLink(token)
//
// Everything here is a reply inside a conversation the visitor started, so it is always within
// WhatsApp's 24-hour customer-service window: no templates are needed. Feedback is never pushed
// as an outbound message; an unanswered offer is shown again in the visitor's next conversation.

export const STATES = ['WELCOME', 'MENU', 'HOTEL_SELECTION', 'PICKUP', 'ARRIVAL_DAY', 'ARRIVAL_DATE', 'ARRIVAL_TIME', 'PASSENGERS',
  'LUGGAGE', 'NAME', 'PHONE', 'TRANSPORT_SELECTION', 'BOOKING_CONFIRMATION', 'BOOKED', 'VERIFICATION', 'VERIFY_MORE',
  'REPORT_SERVICE', 'INCIDENT_CATEGORY', 'INCIDENT_DESCRIPTION', 'INCIDENT_URGENT', 'COMPLETED',
  'ACCOM_QUERY', 'PROVIDER_QUERY', 'CHECK_DONE', 'STATUS_QUERY', 'TIPS_STAGE', 'FEEDBACK_PICK', 'FEEDBACK_ASK', 'FEEDBACK']

const CATEGORIES = [
  ['driver_mismatch', 'Driver doesn’t match'], ['code_incorrect', 'Code incorrect'], ['vehicle_mismatch', 'Vehicle doesn’t match'],
  ['extra_payment', 'Asked to pay extra'], ['suspected_scam', 'Suspected scam'], ['intimidation', 'Threatened/intimidated'],
  ['cannot_locate_driver', 'Can’t find my driver'], ['other', 'Something else'],
]
const ACC_CATEGORIES = [
  ['listing_mismatch', 'Not as advertised', 'Address, photos or rooms differ from the listing'],
  ['booking_payment_fraud', 'Suspicious payment', 'Odd payment request, changed bank details, deposit'],
  ['host_identity_mismatch', 'Contact details differ', 'Name, phone or email doesn’t match'],
  ['accommodation_unsafe', 'I felt unsafe', 'At check-in or around the accommodation'],
  ['accommodation_other', 'Something else', 'Another accommodation problem'],
]
const OUTCOME_CATEGORY = { code_mismatch: 'code_incorrect', details_mismatch: 'driver_mismatch', wrong_vehicle: 'vehicle_mismatch', cannot_find: 'cannot_locate_driver' }
const INCIDENT_STATUS = { received: 'Received', hotel_notified: 'Hotel notified', hotel_pending: 'Waiting for the hotel', provider_notified: 'Transport provider notified',
  escalated: 'Escalated', referred_authorities: 'Referred to the authorities', follow_up: 'Being followed up', resolved: 'Marked resolved', closed: 'Closed' }
const PARTNER = { approved_partner: '✅ SafeArrival partner', under_review_not_approved: '⏳ Under review, NOT approved', suspended: '⛔ Partnership suspended' }
const EMERGENCY = 'If you are in danger right now:\n🚓 Police (SAPS): 10111\n🚑 Ambulance: 10177\n📱 Any emergency from a mobile: 112\n\nMove to a busy, well-lit public area — inside the terminal if you are at the airport.'
const ASK_AGAIN_MS = 12 * 3600e3 // ask for feedback at most once every 12 hours (visitors can always offer it from the menu)

const text = (t) => ({ type: 'text', text: t })
const buttons = (t, b) => ({ type: 'buttons', text: t, buttons: b.map(([id, title]) => ({ id, title: title.slice(0, 20) })) })
const list = (t, button, rows) => ({ type: 'list', text: t, button, rows: rows.slice(0, 10).map(([id, title, description]) => ({ id, title: title.slice(0, 24), description: description?.slice(0, 72) })) })
const rand = (n) => `R${Math.round(Number(n)).toLocaleString('en-ZA')}`
const price = (o) => (o.price_type === 'agreed' ? `${rand(o.price_amount)} agreed price` : o.price_type === 'estimate' ? `${rand(o.price_min)}–${rand(o.price_max)} estimate` : 'price confirmed by provider')
const demo = (r) => (r?.data_notice ? `\n\n_${r.data_notice}_` : '')

// South Africa has no daylight saving: SAST is always UTC+2.
const sastDate = (offsetDays = 0) => new Date(Date.now() + 2 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10)
function parseTime(s) {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let h = +m[1]; const min = +(m[2] ?? 0)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null
}
function parseDate(s) {
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return t
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/)
  if (!m) return null
  const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : sastDate().slice(0, 4)
  const d = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return Number.isNaN(Date.parse(d)) ? null : (!m[3] && d < sastDate() ? `${+year + 1}${d.slice(4)}` : d)
}

// ---------------------------------------------------------------- feedback
// Short flows: one rating, one or two relevant questions, optional comment. Keys match the
// backend's whitelist (public.submit_feedback); helpful/confident/use_again are their own columns.
const RATING = [['fb:5', 'Excellent'], ['fb:4', 'Good'], ['fb:3', 'Okay'], ['fb:2', 'Poor'], ['fb:1', 'Very poor']]
const SAFETY = [['fb:5', 'Very safe'], ['fb:4', 'Safe'], ['fb:3', 'Neutral'], ['fb:2', 'Unsafe'], ['fb:1', 'Very unsafe']]
const FB_Q = {
  overall_rating: ['scale', 'How would you rate your overall experience?', RATING],
  safety_rating: ['scale', 'How safe did you feel during your {what}?', SAFETY],
  helpful: ['yn', 'Did SafeArrival help you?'],
  confident: ['yn', 'Did you feel more confident after using SafeArrival?'],
  driver_matched: ['yn', 'Did the driver and vehicle match the booking?'],
  price_respected: ['yn', 'Was the agreed price respected?'],
  matched_description: ['yn', 'Did the accommodation match its advertised description?'],
  checkin_safe: ['yn', 'Did you feel safe during check-in?'],
  reporting_easy: ['yn', 'Was reporting easy?'],
  next_steps_clear: ['yn', 'Were the next steps clear?'],
  received_update: ['yn', 'Did you receive an update on your report?'],
  communication_ok: ['yn', 'Were you satisfied with the communication?'],
  comment: ['comment', 'Anything else you’d like to tell us? Type a short message, or tap Skip. Please don’t include names or phone numbers.'],
}
const FB_FLOW = {
  pickup: ['safety_rating', 'driver_matched', 'price_respected', 'confident', 'comment'],
  stay: ['safety_rating', 'overall_rating', 'matched_description', 'checkin_safe', 'comment'],
  accom_check: ['overall_rating', 'helpful', 'confident', 'comment'],
  provider_check: ['overall_rating', 'helpful', 'confident', 'comment'],
  incident: ['overall_rating', 'reporting_easy', 'next_steps_clear', 'comment'],
  incident_followup: ['overall_rating', 'received_update', 'communication_ok', 'comment'],
  guidance: ['overall_rating', 'helpful', 'confident', 'comment'],
}
const FB_WHAT = { pickup: 'pickup', stay: 'stay' }
const fbQuestion = (ctx) => FB_FLOW[ctx.fb.flow][ctx.fb.step]
const home = (ctx) => (ctx.bookingToken ? 'BOOKED' : 'MENU')

/** Remember a feedback offer for the interaction that just finished. With ask=true, returns true
 *  (and records the ask) if we may prompt now; otherwise the offer only shows as a button/menu row. */
function offer(ctx, o, ask = true) {
  ctx.feedbackOffer = { returnTo: home(ctx), ...o }
  if (!ask || (ctx.lastAskedAt && Date.now() - ctx.lastAskedAt < ASK_AGAIN_MS)) return false
  ctx.lastAskedAt = Date.now()
  return true
}

async function startFeedback(ctx, api) {
  const o = ctx.feedbackOffer
  if (!o) return { next: 'FEEDBACK_PICK' }
  const r = await api.requestFeedback({ service: o.service, booking_token: o.booking_token, incident_token: o.incident_token,
    hotel_slug: o.hotel_slug, provider_id: o.provider_id })
  if (!r?.ref) return { next: o.returnTo, ctx: { ...ctx, feedbackOffer: null }, replies: [text('You’ve already given feedback on this. Thank you!')] }
  return { next: 'FEEDBACK', ctx: { ...ctx, fb: { ref: r.ref, flow: o.flow, step: 0, data: { answers: {} }, returnTo: o.returnTo } },
    replies: [text('Thank you! A few quick taps. Your answers are anonymous, and you can stop at any time by typing *menu*.')] }
}

// ---------------------------------------------------------------- prompts
const prompts = {
  async WELCOME(ctx) {
    const back = ctx.bookingRef ? `\n\nWelcome back${ctx.name ? `, ${ctx.name.split(' ')[0]}` : ''}! Your booking is ${ctx.bookingRef}.` : ''
    const fb = ctx.feedbackOffer ? `\n\nYou can still tell us how your ${ctx.feedbackOffer.label} went: choose *Give feedback*.` : ''
    return [
      text(`Welcome to Cape Town! 🌍\n\nSafeArrival helps you stay safe with your accommodation and your transport.${ctx.hotelName ? `\n\nYou're connected to *${ctx.hotelName}*.` : ''}${back}\n\nWith our service, you can:\n1. Check an accommodation or transport company.\n2. Arrange trusted transport and verify your driver.\n3. See your agreed transport price.\n4. Report suspicious activity and follow up on your report.${fb}`),
      ...(await prompts.MENU(ctx)),
    ]
  },
  async MENU() {
    return [list('How can we help you today?', 'Choose an option', [
      ['arrange', 'Arrange transport', 'Book a trusted pickup to your accommodation'],
      ['view', 'View my booking', 'Status, price and driver details'],
      ['verify', 'Verify my driver', 'Check your driver before you get in'],
      ['accom', 'Check accommodation', 'Is it a partner? Do the contact details match?'],
      ['provider', 'Check transport company', 'Is this shuttle or transfer company a partner?'],
      ['wrong', 'Something’s wrong', 'Report accommodation or transport problems'],
      ['status', 'Check my report', 'Updates on a report you made'],
      ['tips', 'Safety tips', 'Before you arrive, during your visit, after an incident'],
      ['feedback', 'Give feedback', 'Tell us how SafeArrival worked for you'],
      ['emergency', 'Emergency assistance', 'Emergency numbers in South Africa'],
    ])]
  },
  async HOTEL_SELECTION(ctx, api) {
    const hotels = await api.hotels()
    return [list('Where are you staying? Only partner hotels can arrange trusted transport.', 'Choose hotel',
      hotels.map((h) => [`hotel:${h.slug}`, h.name, h.area]))]
  },
  async PICKUP(ctx, api) {
    const pts = await api.pickupPoints()
    return [list('Where should we pick you up?', 'Pickup location', pts.map((p) => [`pickup:${p.id}`, p.name.split(' · ')[1] ?? p.name, p.name.split(' · ')[0]]))]
  },
  async ARRIVAL_DAY() { return [buttons('When do you arrive?', [['day:0', 'Today'], ['day:1', 'Tomorrow'], ['day:other', 'Another date']])] },
  async ARRIVAL_DATE() { return [text('Type your arrival date, e.g. 28/11.')] },
  async ARRIVAL_TIME() { return [text('What time do you land or want to be picked up? Type a time, e.g. 14:30.')] },
  async PASSENGERS() { return [list('How many passengers, including you?', 'Passengers', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`pax:${n}`, `${n} passenger${n > 1 ? 's' : ''}`]))] },
  async LUGGAGE() { return [list('How many large bags or suitcases?', 'Luggage', [0, 1, 2, 3, 4, 5, 6, 8].map((n) => [`bags:${n}`, n === 0 ? 'No large bags' : `${n} bag${n > 1 ? 's' : ''}`]))] },
  async NAME(ctx) {
    return ctx.profileName ? [buttons(`Which name should the booking be under?`, [['name:profile', ctx.profileName], ['name:other', 'Different name']])]
      : [text('What name should the booking be under? (Your driver sees only your first name.)')]
  },
  async PHONE() { return [text('What is your WhatsApp number, with country code? e.g. +44 7700 900123')] },
  async TRANSPORT_SELECTION(ctx, api) {
    const opts = (await api.options(ctx.hotelSlug)).filter((o) => o.passenger_capacity >= ctx.passengers && o.luggage_capacity >= ctx.luggage)
    if (!opts.length) return [text(`Sorry, none of ${ctx.hotelName}'s transport options fit ${ctx.passengers} passengers and ${ctx.luggage} bags. Please contact the hotel directly — or choose fewer bags.`), ...(await prompts.MENU(ctx))]
    return [list(`Transport options from ${ctx.hotelName}. Prices are shown before you confirm.`, 'See options', opts.map((o) => [`opt:${o.id}`, o.provider_name, `${price(o)} · ${o.vehicle_class} · ${o.passenger_capacity} pax · ${o.luggage_capacity} bags`]))]
  },
  async BOOKING_CONFIRMATION(ctx) {
    const o = ctx.option
    return [buttons(
      `Please check your booking:\n\n🏨 ${ctx.hotelName}\n📍 Pickup: ${ctx.pickupName}\n🕑 ${ctx.date} at ${ctx.time}\n👥 ${ctx.passengers} passenger(s), ${ctx.luggage} bag(s)\n🚐 ${o.provider_name} · ${o.vehicle_class}\n💰 ${price(o)}\n💳 ${o.payment_arrangement}\n\n${o.price_type === 'estimate' ? 'This is an estimate, not a fixed fare.' : o.price_type === 'on_request' ? 'The provider will confirm the price before pickup.' : 'You should not be asked to pay the driver anything extra.'}`,
      [['confirm', 'Confirm booking'], ['change', 'Change option'], ['menu', 'Cancel']])]
  },
  async BOOKED() { return [buttons('What would you like to do next?', [['view', 'View my booking'], ['verify', 'Verify my driver'], ['wrong', 'Something’s wrong']])] },
  async VERIFICATION() {
    return [buttons('When you meet your driver, ask them to say your verification code. *Do not say it first.*\n\nDoes the code they said match the one in your driver message? You can also type what they said and I\'ll check it.',
      [['v:verified', '✅ Code matches'], ['v:code_mismatch', '❌ Doesn’t match'], ['v:more', 'Other problem']])]
  },
  async VERIFY_MORE() {
    return [list('What’s the problem? Do not get into the vehicle.', 'Choose', [
      ['v:details_mismatch', 'Driver doesn’t match', 'Name or photo is different'],
      ['v:wrong_vehicle', 'Wrong vehicle', 'Registration, make or colour is different'],
      ['v:cannot_find', 'I can’t find my driver', 'Nobody at the meeting point'],
    ])]
  },
  async REPORT_SERVICE() { return [buttons('I’m sorry something is wrong. Is it about transport or accommodation?', [['rs:transport', 'Transport'], ['rs:accommodation', 'Accommodation']])] },
  async INCIDENT_CATEGORY(ctx) {
    return ctx.reportService === 'accommodation'
      ? [list('What happened with the accommodation?', 'Choose', ACC_CATEGORIES.map(([id, t, d]) => [`cat:${id}`, t, d]))]
      : [list('What happened?', 'Choose', CATEGORIES.map(([id, t]) => [`cat:${id}`, t]))]
  },
  async INCIDENT_DESCRIPTION(ctx) {
    const acc = ctx.reportService === 'accommodation' && !ctx.subjectName
    return [buttons(`Tell us briefly what happened and where you are${acc ? ', including the name of the accommodation' : ''} (type a message), or skip.`, [['skip', 'Skip']])]
  },
  async INCIDENT_URGENT() { return [buttons('Do you need immediate assistance?', [['urgent:yes', 'Yes, I need help now'], ['urgent:no', 'No, I am safe']])] },
  async COMPLETED(ctx) {
    return [buttons(`Enjoy Cape Town! If anything goes wrong, message us any time.${ctx.feedbackOffer ? ' After your trip, tap *Give feedback* to tell us how it went.' : ''}`,
      [['wrong', 'Something’s wrong'], ...(ctx.feedbackOffer ? [['fb:start', 'Give feedback']] : []), ['menu', 'Main menu']])]
  },
  async ACCOM_QUERY() { return [text('Type the name of the accommodation. You can add the phone number you were given to check it, e.g. _Saltwater Lodge +27 21 000 0101_.')] },
  async PROVIDER_QUERY() { return [text('Type the name of the transport or shuttle company, e.g. _Cape Town Trusted Shuttle_.')] },
  async CHECK_DONE() { return [buttons('What would you like to do next?', [['fb:start', 'Give feedback'], ['report', 'Report a concern'], ['menu', 'Main menu']])] },
  async STATUS_QUERY() { return [text('Paste the tracking link from your report message (it ends in a long code), or type *menu* to go back.')] },
  async TIPS_STAGE() {
    return [list('Safety tips for which stage of your visit?', 'Choose', [
      ['tips:before_arrival', 'Before you arrive', 'Accommodation checks, booking scams, transport'],
      ['tips:during_visit', 'During your visit', 'Verifying drivers, payments, check-in'],
      ['tips:after_incident', 'After an incident', 'Reporting, references, support'],
    ])]
  },
  async FEEDBACK_PICK(ctx) {
    return [list('What would you like to give feedback on?', 'Choose', [
      ['fbk:stay', 'My accommodation', 'How safe and as-described was your stay?'],
      ...(ctx.bookingToken ? [['fbk:pickup', 'My transport', 'Your pickup and driver']] : []),
      ['fbk:general', 'SafeArrival in general', 'Was it easy and useful?'],
    ])]
  },
  async FEEDBACK_ASK(ctx) {
    return [buttons(`Could you spare 30 seconds to rate this ${ctx.feedbackOffer?.label ?? 'experience'}? It’s optional and anonymous.`,
      [['fb:start', 'Give feedback'], ['fb:later', 'Not now']])]
  },
  async FEEDBACK(ctx) {
    const key = fbQuestion(ctx)
    const [kind, q, rows] = FB_Q[key]
    const n = `(${ctx.fb.step + 1}/${FB_FLOW[ctx.fb.flow].length}) `
    if (kind === 'scale') {
      return [list(n + q.replace('{what}', FB_WHAT[ctx.fb.flow] ?? 'experience'), 'Choose',
        [...rows, ...(ctx.fb.step === 0 ? [['fb:later', 'Not now']] : [])])]
    }
    if (kind === 'yn') return [buttons(n + q, [['fb:yes', 'Yes'], ['fb:partly', 'Partly'], ['fb:no', 'No']])]
    return [buttons(n + q, [['fb:skip', 'Skip']])]
  },
}

// ---------------------------------------------------------------- handlers
// Each returns { next, ctx?, replies? } or { invalid: 'message' }.
async function viewBooking(ctx, api) {
  if (!ctx.bookingToken) return { next: 'MENU', replies: [text('I can’t find a booking for you yet. Choose *Arrange transport* to make one.')] }
  const t = await api.getTrip(ctx.bookingToken)
  const b = t.booking
  const lines = [`*${b.reference}* — ${api.statusLabel(b.status)}`, `🕑 ${api.fmtTime(b.pickup_at)}`, `📍 ${t.pickup_point.name}`, `🚐 ${t.provider?.name ?? 'Provider to be confirmed'}`, `💰 ${api.priceText(b)}`]
  if (t.driver) lines.push(`\n👤 ${t.driver.full_name}\n🚗 ${t.driver.colour} ${t.driver.make} ${t.driver.model} · ${t.driver.registration}`)
  lines.push(`\nFull details & map: ${api.tripLink(ctx.bookingToken)}`)
  const verifying = ['driver_assigned', 'driver_on_way', 'driver_arrived'].includes(b.status)
  return { next: verifying ? 'VERIFICATION' : b.status === 'in_progress' || b.status === 'completed' ? 'COMPLETED' : 'BOOKED', replies: [text(lines.join('\n'))] }
}

async function startVerify(ctx, api) {
  if (!ctx.bookingToken) return { next: 'MENU', replies: [text('You don’t have a booking with us yet, so there’s no driver to verify. If someone says they are your driver, do not go with them.')] }
  const t = await api.getTrip(ctx.bookingToken)
  if (!['driver_assigned', 'driver_on_way', 'driver_arrived'].includes(t.booking.status)) {
    return { next: 'BOOKED', replies: [text(t.booking.status === 'in_progress' || t.booking.status === 'completed' ? 'Your driver is already verified.' : 'Your driver hasn’t been assigned yet. We’ll message you their details and your verification code as soon as they are. *If anyone approaches you claiming to be your driver before then, do not go with them.*')] }
  }
  return { next: 'VERIFICATION' }
}

async function submitIncident(ctx, api, urgent) {
  const acc = ctx.reportService === 'accommodation'
  const r = await api.reportIncident({ booking_token: ctx.bookingToken, hotel_slug: ctx.hotelSlug, category: ctx.category,
    description: ctx.description, needs_immediate_help: urgent, location_text: acc ? null : ctx.pickupName,
    subject_name: acc ? ctx.subjectName : null, subject_hotel_slug: acc ? ctx.subjectSlug : null })
  const msgs = [text(`Your report has been received.\n\nReference: *${r.reference}*\n\n${acc ? 'Our safety team will review it. ' : ctx.bookingToken ? 'Your hotel has been notified. ' : ''}We will keep you updated as your report progresses. You can check it any time with *Check my report*.\nTrack it here: ${api.incidentLink(r.access_token)}\n\nThis is an internal reference, not a police case number.`)]
  if (urgent) msgs.unshift(text(EMERGENCY))
  const c = { ...ctx, category: null, description: null, reportService: null, subjectName: null, subjectSlug: null, lastIncidentToken: r.access_token,
    incidentTokens: [r.access_token, ...(ctx.incidentTokens ?? [])].slice(0, 5) }
  // Never ask for feedback when the visitor said they need help now.
  const ask = !urgent && offer(c, { service: 'incident', flow: 'incident', incident_token: r.access_token, label: 'report' })
  return { next: ask ? 'FEEDBACK_ASK' : home(c), ctx: c, replies: msgs }
}

async function accommodationCheck(t, ctx, api) {
  const phone = t.match(/\+?\d[\d\s()-]{6,}\d/)?.[0] ?? ''
  const name = t.replace(phone, '').replace(/[\s,;:.-]+$/, '').trim()
  if (name.length < 3) return { invalid: 'Please type at least 3 letters of the accommodation’s name.' }
  const r = await api.checkAccommodation({ name, phone })
  const lines = r.matches.slice(0, 3).map((m) => {
    const l = [`*${m.name}* (${m.area}) — ${PARTNER[m.safearrival_status] ?? m.safearrival_status}`]
    if (m.official_contacts) l.push(`📍 ${m.official_contacts.address ?? '—'}\n📞 ${m.official_contacts.phone ?? '—'}`)
    if (m.contact_check === 'match') l.push('✅ The number you were given matches the official number we hold.')
    if (m.contact_check === 'mismatch') l.push('⚠️ The number you were given does *NOT* match the official number we hold.')
    return l.join('\n')
  })
  const top = r.matches[0]
  const msg = [...(r.matches.length ? [] : [`We have no record of “${name}”.`]), ...lines, ...r.warnings.map((w) => `⚠️ ${w}`),
    `\nTips:\n• ${r.guidance.slice(0, 2).join('\n• ')}`, `\n_Partner status means we hold verified contact details; it is not a guarantee of safety._`].join('\n\n')
  const c = { ...ctx, lastCheck: { service: 'accommodation' }, subjectName: top?.name ?? name, subjectSlug: top?.slug ?? null }
  offer(c, { service: 'accommodation', flow: 'accom_check', hotel_slug: top?.slug, label: 'accommodation check', returnTo: 'MENU' }, false)
  return { next: 'CHECK_DONE', ctx: c, replies: [text(msg + demo(r))] }
}

async function providerCheck(t, ctx, api) {
  const name = t.trim()
  if (name.length < 3) return { invalid: 'Please type at least 3 letters of the company’s name.' }
  const r = await api.checkProvider({ provider_name: name.slice(0, 120) })
  const lines = r.matches.slice(0, 3).map((m) => [`*${m.name}* — ${PARTNER[m.safearrival_status] ?? m.safearrival_status}`, m.meaning,
    m.contacts ? `📞 ${m.contacts.phone ?? '—'}${m.contacts.safety_contact ? `\n🛡️ Safety contact: ${m.contacts.safety_contact}` : ''}` : null,
    m.service_coverage?.length ? `Areas: ${m.service_coverage.join(', ')}` : null].filter(Boolean).join('\n'))
  const msg = [...(lines.length ? lines : [`“${name}” is not a SafeArrival partner.`]), r.note,
    'Whoever the company is, the driver should match your booking. With a SafeArrival booking, the driver must say your code first.'].join('\n\n')
  const top = r.matches[0]
  const c = { ...ctx, lastCheck: { service: 'transport' }, subjectName: top?.name ?? name, subjectSlug: null }
  offer(c, { service: 'transport', flow: 'provider_check', provider_id: top?.provider_id, label: 'transport company check', returnTo: 'MENU' }, false)
  return { next: 'CHECK_DONE', ctx: c, replies: [text(msg + demo(r))] }
}

async function showReports(tokens, ctx, api) {
  const out = []; let followedUp = null
  for (const tok of tokens.slice(0, 3)) {
    const r = await api.getIncident(tok)
    const i = r.incident
    const latest = r.updates.slice(-2).map((u) => `• ${u.message}`).join('\n')
    out.push(`*${i.reference}* — ${INCIDENT_STATUS[i.status] ?? i.status}\nReported ${api.fmtTime(i.created_at)}\n${latest}`)
    if (!followedUp && ['follow_up', 'escalated', 'referred_authorities', 'resolved', 'closed'].includes(i.status)) followedUp = tok
  }
  const c = { ...ctx, incidentTokens: [...new Set([...tokens, ...(ctx.incidentTokens ?? [])])].slice(0, 5) }
  const replies = [text(`${out.join('\n\n')}\n\nThese are SafeArrival references, not police case numbers. In an emergency call 10111 or 112.`)]
  const ask = followedUp && offer(c, { service: 'incident', flow: 'incident_followup', incident_token: followedUp, label: 'report follow-up' })
  return { next: ask ? 'FEEDBACK_ASK' : home(c), ctx: c, replies }
}

const YN = { 'fb:yes': 'yes', 'fb:partly': 'partly', 'fb:no': 'no', yes: 'yes', partly: 'partly', no: 'no' }
async function answerFeedback({ id, text: t }, ctx, api) {
  if (id === 'fb:later') return { next: ctx.fb.returnTo, ctx: { ...ctx, fb: null }, replies: [text('No problem. You can give feedback later from the menu.')] }
  const key = fbQuestion(ctx)
  const kind = FB_Q[key][0]
  const data = { ...ctx.fb.data, answers: { ...ctx.fb.data.answers } }
  if (kind === 'scale') {
    const n = +(id?.match(/^fb:([1-5])$/)?.[1] ?? t?.trim().match(/^[1-5]$/)?.[0] ?? NaN)
    if (!n) return { invalid: 'Please choose an option from the list (or type 1–5).' }
    data[key] = n
  } else if (kind === 'yn') {
    const v = YN[id] ?? YN[t?.trim().toLowerCase()]
    if (!v) return { invalid: 'Please tap Yes, Partly or No.' }
    if (['helpful', 'confident', 'use_again'].includes(key)) data[key] = v
    else data.answers[key] = v
  } else if (id !== 'fb:skip') {
    if (!t?.trim()) return { invalid: 'Type a short message, or tap Skip.' }
    data.comment = t.trim().slice(0, 1000)
  }
  const fb = { ...ctx.fb, data, step: ctx.fb.step + 1 }
  if (fb.step < FB_FLOW[fb.flow].length) return { next: 'FEEDBACK', ctx: { ...ctx, fb } }

  await api.submitFeedback({ ref: fb.ref, ...data })
  const negative = data.safety_rating <= 2 || data.overall_rating <= 2 || Object.values(data.answers).includes('no')
  return { next: fb.returnTo, ctx: { ...ctx, fb: null, feedbackOffer: null, lastAskedAt: Date.now() },
    replies: [text(`Thank you for your feedback! 🙏${negative ? '\n\nI’m sorry it wasn’t better. Feedback is anonymous and isn’t a report: if something unsafe happened, choose *Something’s wrong* so our safety team can follow up.' : ''}`)] }
}

const handlers = {
  async MENU({ id }, ctx, api) {
    if (id === 'arrange') return { next: ctx.hotelSlug ? 'PICKUP' : 'HOTEL_SELECTION', replies: ctx.hotelSlug ? [text(`Booking with *${ctx.hotelName}*.`)] : [] }
    if (id === 'view') return viewBooking(ctx, api)
    if (id === 'verify') return startVerify(ctx, api)
    if (id === 'wrong') return { next: 'REPORT_SERVICE', ctx: { ...ctx, subjectName: null, subjectSlug: null } }
    if (id === 'accom') return { next: 'ACCOM_QUERY' }
    if (id === 'provider') return { next: 'PROVIDER_QUERY' }
    if (id === 'status') return ctx.incidentTokens?.length ? showReports(ctx.incidentTokens, ctx, api) : { next: 'STATUS_QUERY' }
    if (id === 'tips') return { next: 'TIPS_STAGE' }
    if (id === 'feedback') return ctx.feedbackOffer ? startFeedback(ctx, api) : { next: 'FEEDBACK_PICK' }
    if (id === 'emergency') return { next: home(ctx), replies: [text(EMERGENCY)] }
    return { invalid: 'Please choose an option from the menu.' }
  },
  async HOTEL_SELECTION({ id }, ctx, api) {
    const h = (await api.hotels()).find((x) => `hotel:${x.slug}` === id)
    return h ? { next: 'PICKUP', ctx: { ...ctx, hotelSlug: h.slug, hotelName: h.name } } : { invalid: 'Please choose your hotel from the list.' }
  },
  async PICKUP({ id }, ctx, api) {
    const p = (await api.pickupPoints()).find((x) => `pickup:${x.id}` === id)
    return p ? { next: 'ARRIVAL_DAY', ctx: { ...ctx, pickupId: p.id, pickupName: p.name } } : { invalid: 'Please choose a pickup location from the list.' }
  },
  async ARRIVAL_DAY({ id }, ctx) {
    if (id === 'day:0' || id === 'day:1') return { next: 'ARRIVAL_TIME', ctx: { ...ctx, date: sastDate(+id.slice(4)) } }
    if (id === 'day:other') return { next: 'ARRIVAL_DATE' }
    return { invalid: 'Please tap Today, Tomorrow or Another date.' }
  },
  async ARRIVAL_DATE({ text: t = '' }, ctx) {
    const d = parseDate(t)
    if (!d || d < sastDate()) return { invalid: 'I couldn’t read that date. Please type it like 28/11.' }
    return { next: 'ARRIVAL_TIME', ctx: { ...ctx, date: d } }
  },
  async ARRIVAL_TIME({ text: t = '' }, ctx) {
    const time = parseTime(t)
    if (!time) return { invalid: 'Please type a time like 14:30.' }
    if (new Date(`${ctx.date}T${time}:00+02:00`) < Date.now() - 3600e3) return { invalid: 'That time has already passed today. Please type a later time.' }
    return { next: 'PASSENGERS', ctx: { ...ctx, time } }
  },
  async PASSENGERS({ id }, ctx) { return id?.startsWith('pax:') ? { next: 'LUGGAGE', ctx: { ...ctx, passengers: +id.slice(4) } } : { invalid: 'Please choose the number of passengers.' } },
  async LUGGAGE({ id }, ctx) {
    if (!id?.startsWith('bags:')) return { invalid: 'Please choose the number of bags.' }
    const c = { ...ctx, luggage: +id.slice(5) }
    return { next: c.name ? (c.phone ? 'TRANSPORT_SELECTION' : 'PHONE') : 'NAME', ctx: c }
  },
  async NAME({ id, text: t }, ctx) {
    if (id === 'name:profile') return { next: ctx.phone ? 'TRANSPORT_SELECTION' : 'PHONE', ctx: { ...ctx, name: ctx.profileName } }
    if (id === 'name:other') return { next: 'NAME', ctx: { ...ctx, profileName: null } }
    const n = (t ?? '').trim()
    if (n.length < 2 || n.length > 60) return { invalid: 'Please type your name (2–60 characters).' }
    return { next: ctx.phone ? 'TRANSPORT_SELECTION' : 'PHONE', ctx: { ...ctx, name: n } }
  },
  async PHONE({ text: t = '' }, ctx) {
    const p = t.replace(/[\s()-]/g, '')
    if (!/^\+[1-9]\d{7,14}$/.test(p)) return { invalid: 'Please include your country code, e.g. +44 7700 900123.' }
    return { next: 'TRANSPORT_SELECTION', ctx: { ...ctx, phone: p } }
  },
  async TRANSPORT_SELECTION({ id }, ctx, api) {
    const o = (await api.options(ctx.hotelSlug)).find((x) => `opt:${x.id}` === id)
    return o ? { next: 'BOOKING_CONFIRMATION', ctx: { ...ctx, option: o } } : { invalid: 'Please choose a transport option from the list.' }
  },
  async BOOKING_CONFIRMATION({ id }, ctx, api) {
    if (id === 'change') return { next: 'TRANSPORT_SELECTION' }
    if (id !== 'confirm') return { invalid: 'Please tap Confirm booking, Change option or Cancel.' }
    const r = await api.createBooking({ full_name: ctx.name, whatsapp: ctx.phone, hotel_slug: ctx.hotelSlug, partner_id: ctx.option.id,
      pickup_point_id: ctx.pickupId, pickup_at: `${ctx.date}T${ctx.time}:00+02:00`, passengers: ctx.passengers, luggage: ctx.luggage,
      source: ctx.source ?? 'whatsapp' })
    return { next: 'BOOKED', ctx: { ...ctx, bookingToken: r.access_token, bookingRef: r.reference, option: null },
      replies: [text(`Booking request sent ✅\n\nReference: *${r.reference}*\nYour booking page: ${api.tripLink(r.access_token)}`)] }
  },
  async BOOKED({ id }, ctx, api) {
    if (id === 'view') return viewBooking(ctx, api)
    if (id === 'verify') return startVerify(ctx, api)
    return handlers.MENU({ id }, ctx, api)
  },
  async VERIFICATION({ id, text: t }, ctx, api) {
    if (id === 'v:more') return { next: 'VERIFY_MORE' }
    if (t && !id) {
      const { match } = await api.checkCode(ctx.bookingToken, t)
      return match
        ? { next: 'VERIFICATION', replies: [text('✅ That matches your code. Check the registration too, then tap “Code matches” to start your ride.')] }
        : { next: 'VERIFY_MORE', replies: [text('❌ That does NOT match your code. *Do not get into the vehicle.* Stay inside the terminal or another busy public place.')] }
    }
    return handlers.VERIFY_MORE({ id }, ctx, api)
  },
  async VERIFY_MORE({ id }, ctx, api) {
    const outcome = id?.slice(2)
    if (!['verified', 'code_mismatch', 'details_mismatch', 'wrong_vehicle', 'cannot_find'].includes(outcome)) return { invalid: 'Please choose one of the options.' }
    await api.recordVerification(ctx.bookingToken, outcome)
    if (outcome === 'verified') {
      const c = { ...ctx }
      offer(c, { service: 'transport', flow: 'pickup', booking_token: ctx.bookingToken, label: 'pickup', returnTo: 'COMPLETED' }, false)
      return { next: 'COMPLETED', ctx: c, replies: [text('Driver verified ✅ Have a safe trip!')] }
    }
    return { next: 'INCIDENT_DESCRIPTION', ctx: { ...ctx, category: OUTCOME_CATEGORY[outcome], reportService: 'transport' },
      replies: [text('*Do not enter the vehicle.* Stay inside the terminal or another busy public place. We are alerting your hotel and the transport provider.')] }
  },
  async REPORT_SERVICE({ id }, ctx) {
    if (id === 'rs:transport' || id === 'rs:accommodation') return { next: 'INCIDENT_CATEGORY', ctx: { ...ctx, reportService: id.slice(3) } }
    return { invalid: 'Please tap Transport or Accommodation.' }
  },
  async INCIDENT_CATEGORY({ id }, ctx) {
    const cats = ctx.reportService === 'accommodation' ? ACC_CATEGORIES : CATEGORIES
    const c = cats.find(([k]) => `cat:${k}` === id)
    return c ? { next: 'INCIDENT_DESCRIPTION', ctx: { ...ctx, category: c[0] } } : { invalid: 'Please choose what happened from the list.' }
  },
  async INCIDENT_DESCRIPTION({ id, text: t }, ctx) {
    if (id === 'skip') return { next: 'INCIDENT_URGENT' }
    if (!t?.trim()) return { invalid: 'Type a short description, or tap Skip.' }
    return { next: 'INCIDENT_URGENT', ctx: { ...ctx, description: t.trim().slice(0, 2000) } }
  },
  async INCIDENT_URGENT({ id }, ctx, api) {
    if (id !== 'urgent:yes' && id !== 'urgent:no') return { invalid: 'Please tap Yes or No.' }
    return submitIncident(ctx, api, id === 'urgent:yes')
  },
  async COMPLETED({ id }, ctx, api) { return handlers.BOOKED({ id }, ctx, api) },
  async ACCOM_QUERY({ id, text: t }, ctx, api) { return t && !id ? accommodationCheck(t, ctx, api) : { invalid: 'Type the accommodation’s name.' } },
  async PROVIDER_QUERY({ id, text: t }, ctx, api) { return t && !id ? providerCheck(t, ctx, api) : { invalid: 'Type the company’s name.' } },
  async CHECK_DONE({ id }, ctx, api) {
    if (id === 'report') return { next: 'INCIDENT_CATEGORY', ctx: { ...ctx, reportService: ctx.lastCheck?.service ?? 'transport' } }
    return handlers.MENU({ id }, ctx, api)
  },
  async STATUS_QUERY({ text: t = '' }, ctx, api) {
    const tok = t.match(/[0-9a-f]{20,64}/i)?.[0]?.toLowerCase()
    if (!tok) return { invalid: 'I couldn’t find a tracking code in that. Paste the full tracking link from your report message.' }
    try { await api.getIncident(tok) } catch { return { invalid: 'No report matches that tracking code.' } }
    return showReports([tok], ctx, api)
  },
  async TIPS_STAGE({ id }, ctx, api) {
    const stage = id?.startsWith('tips:') && id.slice(5)
    if (!['before_arrival', 'during_visit', 'after_incident'].includes(stage)) return { invalid: 'Please choose a stage from the list.' }
    const r = await api.guidance(stage)
    const body = r.advice.map((a) => `*${a.title}*\n${a.advice}`).join('\n\n')
    const c = { ...ctx }
    const ask = offer(c, { service: 'guidance', flow: 'guidance', label: 'safety tips', returnTo: home(ctx) })
    return { next: ask ? 'FEEDBACK_ASK' : home(c), ctx: c,
      replies: [text(`${body}\n\nIn an emergency call 10111 (police), 10177 (ambulance) or 112 from a mobile. SafeArrival is not an emergency service.`)] }
  },
  async FEEDBACK_PICK({ id }, ctx, api) {
    const o = { 'fbk:stay': { service: 'accommodation', flow: 'stay', hotel_slug: ctx.hotelSlug, label: 'stay' },
      'fbk:pickup': ctx.bookingToken && { service: 'transport', flow: 'pickup', booking_token: ctx.bookingToken, label: 'pickup' },
      'fbk:general': { service: 'guidance', flow: 'guidance', label: 'experience' } }[id]
    if (!o) return { invalid: 'Please choose an option from the list.' }
    return startFeedback({ ...ctx, feedbackOffer: { returnTo: home(ctx), ...o } }, api)
  },
  async FEEDBACK_ASK({ id }, ctx, api) {
    if (id === 'fb:later') return { next: ctx.feedbackOffer?.returnTo ?? home(ctx), replies: [text('No problem. You can give feedback later from the menu.')] }
    return handlers.BOOKED({ id }, ctx, api)
  },
  async FEEDBACK(input, ctx, api) { return answerFeedback(input, ctx, api) },
}

// Free-text states: keywords like "hi" or "staff" are answers there, not commands.
const typing = (state, ctx) => ['INCIDENT_DESCRIPTION', 'NAME', 'ACCOM_QUERY', 'PROVIDER_QUERY', 'STATUS_QUERY'].includes(state)
  || (state === 'FEEDBACK' && FB_Q[fbQuestion(ctx)]?.[0] === 'comment')

const GLOBAL = [
  [/^(hi|hello|hey|start|menu|main menu|restart)\b/i, async (ctx) => ({ next: 'WELCOME', ctx: { ...ctx, category: null, option: null, fb: null } })],
  [/\b(emergency|sos|police|ambulance|danger)\b/i, async (ctx) => ({ next: home(ctx), replies: [text(EMERGENCY)] })],
  [/\b(human|agent|person|staff|call me|speak to)\b/i, async (ctx) => ({ next: home(ctx),
    replies: [text(`A person can help. ${ctx.hotelName ? `Call ${ctx.hotelName}'s front desk${ctx.hotelPhone ? ` on ${ctx.hotelPhone}` : ''}` : 'Your hotel front desk can help directly'}, or reply here and our safety team will follow up during support hours.\n\nIn an emergency call 10111 or 112.`)] })],
]

/** Process one inbound message. Never throws: errors become a friendly reply. */
export async function handle(session, input, api) {
  let state = session?.state ?? 'WELCOME'
  let ctx = { ...(session?.ctx ?? {}) }
  const replies = []
  try {
    let result
    if (input?.id === 'menu') result = { next: 'MENU', ctx: { ...ctx, fb: null } }
    else if (input?.id === 'fb:start') result = await startFeedback(ctx, api)
    else if (input?.text && !input.id) {
      const g = GLOBAL.find(([re]) => re.test(input.text.trim()))
      if (g && !typing(state, ctx)) result = await g[1](ctx)
    }
    if (!result && (state === 'WELCOME' || !session)) result = { next: 'WELCOME' }
    if (!result) result = handlers[state] ? await handlers[state](input ?? {}, ctx, api) : { next: 'WELCOME' }

    if (result.invalid) {
      replies.push(text(`Sorry, I didn’t understand that. ${result.invalid}`), ...(await prompts[state](ctx, api)))
      return { session: { state, ctx }, replies }
    }
    if (result.ctx) ctx = result.ctx
    replies.push(...(result.replies ?? []))
    state = result.next
    replies.push(...(await prompts[state](ctx, api)))
    if (state === 'WELCOME') state = 'MENU'
  } catch (e) {
    replies.push(text(`Sorry — ${e.message ?? 'something went wrong'}.`), ...(await prompts.MENU(ctx)))
    state = ctx.bookingToken ? 'BOOKED' : 'MENU'
    ctx = { ...ctx, fb: null }
  }
  return { session: { state, ctx }, replies }
}
