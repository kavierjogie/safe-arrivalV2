// WhatsApp conversation engine — shared by the web simulator (src/) and the
// production webhook (supabase/functions/whatsapp-webhook). Pure JavaScript,
// no imports, so it runs in the browser and in Deno.
//
//   handle(session, input, api) → { session, replies }
//
// session: { state, ctx }   input: { text } | { id } (tapped button/list row) | { location: { lat, lng, name? } }
// replies use only shapes WhatsApp supports:
//   { type: 'text', text }
//   { type: 'buttons', text, buttons: [{ id, title }] }          ≤3 buttons, title ≤20 chars
//   { type: 'list', text, button, rows: [{ id, title, description }] }  ≤10 rows, title ≤24 chars
//
// Two ways in, one engine: visitors tap the menu OR type what they need, at any point. Typed text
// goes through detectIntent() (deterministic keyword rules, no AI model), which only decides WHERE to
// send the request. Every safety fact shown comes from the database: the same SQL tools the MCP
// server uses (api.tool → public.assistant_tool → private.tool_*), managed by the CTT/admin platform.
//
// api (injected): hotels(), pickupPoints(), options(hotelSlug), createBooking(p), getTrip(token),
//   recordVerification(token, outcome), checkCode(token, code), reportIncident(p),
//   checkAccommodation(p), checkProvider(p), getIncident(token), guidance(stage),
//   requestFeedback(p), submitFeedback(p), tripLink(token), incidentLink(token),
//   tool(name, args) → { ok, data | code, error }, resolvePlace(text), categoryInfo(category),
//   followup(token, kind, message)
//
// Everything here is a reply inside a conversation the visitor started, so it is always within
// WhatsApp's 24-hour customer-service window: no templates are needed. Feedback is never pushed
// as an outbound message; an unanswered offer is shown again in the visitor's next conversation.

export const STATES = ['WELCOME', 'MENU', 'HOTEL_SELECTION', 'PICKUP', 'ARRIVAL_DAY', 'ARRIVAL_DATE', 'ARRIVAL_TIME', 'PASSENGERS',
  'LUGGAGE', 'NAME', 'PHONE', 'TRANSPORT_SELECTION', 'BOOKING_CONFIRMATION', 'BOOKED', 'NO_BOOKING', 'VERIFICATION', 'VERIFY_MORE',
  'REPORT_SERVICE', 'INCIDENT_CATEGORY', 'INCIDENT_DESCRIPTION', 'INCIDENT_LOCATION', 'INCIDENT_URGENT', 'INCIDENT_CONFIRM', 'COMPLETED',
  'ACCOM_QUERY', 'PROVIDER_QUERY', 'CHECK_DONE', 'STATUS_QUERY', 'REPORT_FOLLOWUP', 'FOLLOWUP_INFO', 'TIPS_STAGE', 'SAFETY_MENU',
  'AREA_QUERY', 'ROUTE_FROM', 'ROUTE_TO', 'ALERT_AREA', 'ALERT_CONSENT', 'EMERGENCY_NEXT', 'GUIDANCE_NEXT', 'ANSWERED', 'ASK',
  'FEEDBACK_PICK', 'FEEDBACK_ASK', 'FEEDBACK']

const CATEGORIES = [
  ['driver_mismatch', 'Driver doesn’t match'], ['code_incorrect', 'Code incorrect'], ['vehicle_mismatch', 'Vehicle doesn’t match'],
  ['extra_payment', 'Asked to pay extra'], ['suspected_scam', 'Suspected scam'], ['intimidation', 'Harassed / threatened'],
  ['cannot_locate_driver', 'Can’t find my driver'], ['stranded', 'Lost or stranded'], ['personal_safety', 'I feel unsafe'], ['other', 'Something else'],
]
const ACC_CATEGORIES = [
  ['listing_mismatch', 'Not as advertised', 'Address, photos or rooms differ from the listing'],
  ['booking_payment_fraud', 'Suspicious payment', 'Odd payment request, changed bank details, deposit'],
  ['host_identity_mismatch', 'Contact details differ', 'Name, phone or email doesn’t match'],
  ['accommodation_unsafe', 'I felt unsafe', 'At check-in or around the accommodation'],
  ['accommodation_other', 'Something else', 'Another accommodation problem'],
]
const ACC_IDS = ACC_CATEGORIES.map(([k]) => k)
const OUTCOME_CATEGORY = { code_mismatch: 'code_incorrect', details_mismatch: 'driver_mismatch', wrong_vehicle: 'vehicle_mismatch', cannot_find: 'cannot_locate_driver' }
const INCIDENT_STATUS = { received: 'Received', triage: 'Being reviewed', assigned: 'Assigned to the safety team', in_progress: 'In progress',
  hotel_notified: 'Hotel notified', hotel_pending: 'Waiting for the hotel', provider_notified: 'Transport provider notified',
  awaiting_partner: 'Waiting for the provider', awaiting_visitor: 'Waiting for your reply', escalated: 'Escalated',
  referred_authorities: 'Referred to the authorities', follow_up: 'Being followed up', unable_to_contact: 'We could not reach you',
  resolved: 'Marked resolved', closed: 'Closed' }
const PARTNER = { approved_partner: '✅ SafeArrival partner', under_review_not_approved: '⏳ Under review, NOT approved', suspended: '⛔ Partnership suspended' }
// Kept in code on purpose: emergency numbers must show even if the database is unreachable.
// Identical to public.emergency_contacts (national rows).
const EMERGENCY = 'If you are in danger right now:\n🚓 Police (SAPS): 10111\n🚑 Ambulance: 10177\n📱 Any emergency from a mobile: 112\n\nCall them directly: SafeArrival cannot send police or an ambulance. Move to a busy, well-lit public area — inside the terminal if you are at the airport.'
const ASK_AGAIN_MS = 12 * 3600e3 // ask for feedback at most once every 12 hours (visitors can always offer it from the menu)
const CLASS = { safety_advisory: '🛡️ SAFETY ADVISORY', verified_incident: '✅ VERIFIED INCIDENT', unverified_report: '⚠️ UNVERIFIED REPORT' }

const text = (t) => ({ type: 'text', text: t })
const buttons = (t, b) => ({ type: 'buttons', text: t, buttons: b.map(([id, title]) => ({ id, title: title.slice(0, 20) })) })
const list = (t, button, rows) => ({ type: 'list', text: t, button, rows: rows.slice(0, 10).map(([id, title, description]) => ({ id, title: title.slice(0, 24), description: description?.slice(0, 72) })) })
const rand = (n) => `R${Math.round(Number(n)).toLocaleString('en-ZA')}`
const price = (o) => (o.price_type === 'agreed' ? `${rand(o.price_amount)} agreed price` : o.price_type === 'estimate' ? `${rand(o.price_min)}–${rand(o.price_max)} estimate` : 'price confirmed by provider')
const demo = (r) => (r?.data_notice ? `\n\n_${r.data_notice}_` : '')
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—')
const ago = (d) => { const n = Math.floor((Date.now() - new Date(d)) / 86400e3); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago` }
const newKey = () => `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

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

// ---------------------------------------------------------------- intent detection
// Ordered keyword rules. They only pick a destination; they never produce safety information.
const MENU_WORDS = /^(hi|hello|hey|hallo|start|menu|main menu|restart|help|options)( there)?[\s!.]*$/i
const EMERGENCY_RE = /\b(emergency|sos|police|ambulance|danger|help me|being attacked|attacked me|robbed|mugged|gun|knife|bleeding|unconscious|can'?t breathe)\b/i
const MEDICAL_RE = /\b(ambulance|medical|bleeding|unconscious|injur(ed|y)|heart attack|can'?t breathe|collapsed|overdose)\b/i
const CONCERNS = [
  ['medical_emergency', MEDICAL_RE],
  ['intimidation', /\b(threat\w*|intimidat\w*|harass\w*|aggressive|assault\w*|grabbed|touched me)\b/i],
  ['code_incorrect', /\b((different|wrong|incorrect) code|code (is |was )?(wrong|different|incorrect)|code (doesn'?t|does not|didn'?t) match|(doesn'?t|does not|didn'?t) know (my|the) code)\b/i],
  ['vehicle_mismatch', /\b(number ?plate|registration|(different|wrong) (car|vehicle|colou?r))\b/i],
  ['driver_mismatch', /\b((different|wrong) (driver|person)|driver (doesn'?t|does not|didn'?t) (match|look)|not (my|the) driver)\b/i],
  ['extra_payment', /\b((extra|more|additional) (money|cash|fees?|payment|charges?)|airport (fee|tax|levy)|pay (more|extra|cash)|asking (me )?(for|to pay) (money|cash|more))\b/i],
  ['cannot_locate_driver', /\b((can'?t|cannot|can not) (find|see|locate) (my |the )?driver|driver (isn'?t|is not|not) here|driver (didn'?t|did not|never) (come|arrive|show)|no[- ]show)\b/i],
  ['booking_payment_fraud', /\b(deposit|bank (details|account|transfer)|eft|pay(ment)? (outside|off) the (platform|app|site))\b/i],
  ['listing_mismatch', /\b(not as advertised|(listing|photos?|pictures?) (were |was |are |is )?(different|fake|wrong)|(address|property) (doesn'?t|does not) (exist|match))\b/i],
  ['suspected_scam', /\b(scam\w*|tout\w*|fake (driver|taxi|shuttle)|(someone|a man|a guy|people|a person) (approached|is offering|offered)|offered (me )?a (ride|lift|taxi))\b/i],
  ['stranded', /\b(stranded|stuck|i'?m lost|i am lost|nowhere to (go|stay)|missed my (flight|ride|transfer|pickup)|no way to get)\b/i],
  ['accommodation_unsafe', /\b(unsafe|not safe|scared|afraid)\b.*\b(hotel|room|accommodation|guest ?house|lodge|airbnb|check-?in)\b/i],
  ['personal_safety', /\b(feel unsafe|felt unsafe|not safe|scared|afraid|being followed|following me|someone is watching)\b/i],
]
const INTENTS = [
  ['INCIDENT_STATUS', /\b(check|status|track|follow up on)\b.*\b(report|case|complaint)\b|\b(any|an) updates?\b|has there been an update|\bmy report\b/i],
  ['HOW_IT_WORKS', /\bhow (does|do|is) .*\b(verif\w*|safearrival|this|it) work|\bexplain\b|what is safearrival|what can you do/i],
  ['ALERT_MANAGEMENT', /\b(stop|cancel|pause|unsubscribe|manage)\b.*\balerts?\b|\bunsubscribe\b/i],
  ['ALERT_SUBSCRIPTION', /\b(subscribe|sign me up|notify me|alert me|send me alerts|get alerts)\b/i],
  ['CONCERN', null],
  ['HUMAN_SUPPORT', /\b(human|agent|real person|speak to|talk to|call me|staff|operator)\b/i],
  ['ROUTE_SAFETY', /\broute\b|\bfrom .{3,} to .{3,}|\b(drive|travel|ride|trip|way|road|journey) (from|to|between)\b/i],
  ['AREA_SAFETY', /\b(area|neighbou?rhood|suburb|around (here|my|the)|nearby|near (my|the|here)|is .+ safe|safe (to|in|around|at)|covered)\b/i],
  ['SAFETY_ALERTS', /\b(alerts?|advisor(y|ies)|warnings?)\b/i],
  ['DRIVER_VERIFICATION', /\b(verif\w*|check) (my |the )?driver\b|\bdriver'?s? code\b/i],
  ['TRANSPORT_PROVIDER_CHECK', /\b(transport|shuttle|taxi|transfer|cab|tour) (company|operator|provider|service|firm)\b|\b(check|verify) (this |a |the )?(company|operator|shuttle)\b/i],
  ['ACCOMMODATION_CHECK', /\b(check|verify|legit\w*|real|genuine|partner|trust\w*)\b.*\b(accommodation|hotel|guest ?house|airbnb|lodge|b&b|bnb|host|apartment)\b|\b(accommodation|hotel|guest ?house|airbnb|lodge)\b.*\b(legit\w*|real|genuine|partner|verif\w*)\b/i],
  ['PICKUP_GUIDANCE', /\b(pick-?up (point|location|area|guidance)|meeting point|where (do|should) i (meet|wait)|meet (my|the) driver)\b/i],
  ['BOOKING_LOOKUP', /\bmy (booking|trip|transfer)\b|\bbooking (status|details|reference)\b/i],
  ['BOOK_TRANSPORT', /\b(book|arrange)\b.*\b(transfer|transport|pickup|ride|shuttle|taxi|lift)\b/i],
  ['EMERGENCY_SERVICES', /\b(emergency (numbers?|contacts?|services?)|hospital|police station|numbers? (to|for|i can) call)\b/i],
  ['FEEDBACK', /\b(feedback|rate (you|this|safearrival)|review)\b/i],
  ['INCIDENT_REPORT', /\b(report|complain\w*|something('?s| is) wrong|problem|incident)\b/i],
  ['SAFETY_GUIDANCE', /\b(tips?|advice|guidance|stay safe|precautions?|what should i do|be careful)\b/i],
]
const FOLLOWUPS = [['safe', /\b(i'?m|i am) (safe|ok|okay|fine)( now)?\b/i], ['info', /\b(add|more) (info|information|details)\b/i], ['help', /\bi (still )?need (more )?help\b/i]]
const isQuestion = (t) => /\?\s*$/.test(t) || /^(what|how|is|are|can|could|should|do|does|where|when|why|which|who|will|any)\b/i.test(t.trim())

/** → { intent, category?, kind? }. Exported for tests. */
export function detectIntent(raw, ctx = {}) {
  const t = (raw ?? '').trim()
  if (!t) return { intent: 'GENERAL_QUESTION' }
  if (MENU_WORDS.test(t)) return { intent: 'MAIN_MENU' }
  if (EMERGENCY_RE.test(t)) return { intent: 'EMERGENCY', category: MEDICAL_RE.test(t) ? 'medical_emergency' : 'personal_safety' }
  if (ctx.lastIncidentToken) for (const [kind, re] of FOLLOWUPS) if (re.test(t)) return { intent: 'INCIDENT_FOLLOWUP', kind }
  for (const [intent, re] of INTENTS) {
    if (intent === 'CONCERN') {
      const c = CONCERNS.find(([, r]) => r.test(t))
      if (c) return { intent: isQuestion(t) ? 'SAFETY_GUIDANCE' : 'INCIDENT_REPORT', category: c[0] }
    } else if (re.test(t)) return { intent }
  }
  return { intent: 'GENERAL_QUESTION' }
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
const MENU_ROWS = [
  ['area', 'Check area safety', 'Advisories and reports near a place'],
  ['route', 'Check a route', 'Reports along a trip, e.g. airport to Sea Point'],
  ['provider', 'Verify transport company', 'Is this shuttle or transfer company a partner?'],
  ['accom', 'Check accommodation', 'Is it a partner? Do the contact details match?'],
  ['view', 'My booking', 'View or arrange a trusted pickup'],
  ['verify', 'Verify my driver', 'Check your driver before you get in'],
  ['wrong', 'Report a concern', 'Transport, accommodation or personal safety'],
  ['status', 'Check my report', 'Updates, add information, say you’re safe'],
  ['tips', 'Safety advice & alerts', 'Tips, current alerts, pickup guidance, feedback'],
  ['emergency', 'Emergency / ask a question', 'Emergency numbers, or type any question'],
]
const resumeOffer = (ctx) => (ctx.paused ? [buttons(`You have an unfinished ${ctx.paused.label}. Would you like to continue it?`, [['resume', 'Continue'], ['discard', 'Discard it']])] : [])

const prompts = {
  async WELCOME(ctx) {
    const back = ctx.bookingRef ? `\n\nWelcome back${ctx.name ? `, ${ctx.name.split(' ')[0]}` : ''}! Your booking is ${ctx.bookingRef}.` : ''
    const fb = ctx.feedbackOffer ? `\n\nYou can still tell us how your ${ctx.feedbackOffer.label} went: type *feedback*.` : ''
    return [
      text(`Welcome to SafeArrival 🌍\n\nI can help you check transport and accommodation information, understand safety advisories, verify pickup details or report a concern.${ctx.hotelName ? `\n\nYou're connected to *${ctx.hotelName}*.` : ''}${back}\n\nChoose an option below or simply type what you need. Type *menu* at any time to come back here.${fb}`),
      ...(await prompts.MENU(ctx)),
    ]
  },
  async MENU(ctx) { return [...resumeOffer(ctx), list('How can we help you today?', 'Choose an option', MENU_ROWS)] },
  async ANSWERED(ctx) {
    return [...resumeOffer(ctx), buttons('Anything else? You can also just type your question.', [['menu', 'Main menu'], ['ask', 'Ask a question'], ['status', 'Check my report']])]
  },
  async ASK() { return [text('Type your question in your own words, e.g. _Is there an advisory near the V&A Waterfront?_')] },
  async NO_BOOKING() {
    return [buttons('You don’t have a SafeArrival transport booking in this chat. A partner hotel can arrange a trusted pickup for you.', [['arrange', 'Arrange transport'], ['menu', 'Main menu']])]
  },
  async SAFETY_MENU() {
    return [list('Safety advice and alerts. What would you like?', 'Choose', [
      ['tips:before_arrival', 'Before you arrive', 'Accommodation checks, booking scams, transport'],
      ['tips:during_visit', 'During your visit', 'Verifying drivers, payments, check-in'],
      ['tips:after_incident', 'After an incident', 'Reporting, references, support'],
      ['alerts', 'Current alerts', 'Verified incidents and advisories'],
      ['subscribe', 'Get alerts for an area', 'WhatsApp alerts, only with your consent'],
      ['stopalerts', 'Stop my alerts', 'Unsubscribe alerts set up in this chat'],
      ['pickup', 'Pickup guidance', 'Where to meet your driver, how to check them'],
      ['feedback', 'Give feedback', 'Tell us how SafeArrival worked for you'],
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
  async BOOKED(ctx) { return [...resumeOffer(ctx), buttons('What would you like to do next? You can also type a question.', [['view', 'View my booking'], ['verify', 'Verify my driver'], ['wrong', 'Report a concern']])] },
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
  async REPORT_SERVICE() { return [buttons('I’m sorry something is wrong. What is it about?', [['rs:transport', 'Transport'], ['rs:accommodation', 'Accommodation'], ['rs:personal', 'My personal safety']])] },
  async INCIDENT_CATEGORY(ctx) {
    return ctx.report?.service === 'accommodation'
      ? [list('What happened with the accommodation?', 'Choose', ACC_CATEGORIES.map(([id, t, d]) => [`cat:${id}`, t, d]))]
      : [list('What happened?', 'Choose', CATEGORIES.map(([id, t]) => [`cat:${id}`, t]))]
  },
  async INCIDENT_DESCRIPTION(ctx) {
    const acc = ctx.report?.service === 'accommodation' && !ctx.report.subjectName
    return [buttons(`Tell us briefly what happened${acc ? ', including the name of the accommodation' : ''} (type a message), or skip.`, [['skip', 'Skip']])]
  },
  async INCIDENT_LOCATION() {
    return [buttons('Where did it happen, or where are you now? Type a place (e.g. _International Arrivals_) or share your location 📎. You can skip this.', [['skip', 'Skip']])]
  },
  async INCIDENT_URGENT() { return [buttons('Are you safe right now?', [['urgent:no', 'Yes, I am safe'], ['urgent:yes', 'No, I need help now']])] },
  async INCIDENT_CONFIRM(ctx, api) {
    const d = ctx.report
    const label = (await api.categoryInfo(d.category))?.label ?? d.category
    const lines = [`Here is your report:\n\n*Category:* ${label}`]
    if (d.subjectName) lines.push(`*About:* ${d.subjectName}`)
    if (d.location) lines.push(`*Location:* ${d.location}`)
    if (d.description) lines.push(`*Description:* ${d.description.slice(0, 300)}`)
    if (ctx.bookingRef && d.service === 'transport') lines.push(`*Booking:* ${ctx.bookingRef}`)
    lines.push(`*Safe now:* ${d.urgent ? 'No, needs help now' : d.urgent === false ? 'Yes' : 'Not answered'}`)
    lines.push('\nWould you like me to submit this report to the SafeArrival safety team?')
    return [buttons(lines.join('\n'), [['submit', 'Yes, submit'], ['edit', 'Change details'], ['cancel', 'No, cancel']])]
  },
  async COMPLETED(ctx) {
    return [buttons(`Enjoy Cape Town! If anything goes wrong, message us any time.${ctx.feedbackOffer ? ' After your trip, tap *Give feedback* to tell us how it went.' : ''}`,
      [['wrong', 'Report a concern'], ...(ctx.feedbackOffer ? [['fb:start', 'Give feedback']] : []), ['menu', 'Main menu']])]
  },
  async ACCOM_QUERY() { return [text('Type the name of the accommodation. You can add the phone number you were given to check it, e.g. _Saltwater Lodge +27 21 000 0101_.')] },
  async PROVIDER_QUERY() { return [text('Type the name of the transport or shuttle company, e.g. _Cape Town Trusted Shuttle_.')] },
  async CHECK_DONE() { return [buttons('What would you like to do next?', [['fb:start', 'Give feedback'], ['report', 'Report a concern'], ['menu', 'Main menu']])] },
  async STATUS_QUERY() { return [text('Paste the tracking link from your report message (it ends in a long code), or type *menu* to go back.')] },
  async REPORT_FOLLOWUP() {
    return [buttons('Is there anything you want to tell the safety team about this report?', [['fu:info', 'Add information'], ['fu:safe', 'I’m safe now'], ['fu:help', 'I need more help']])]
  },
  async FOLLOWUP_INFO() { return [text('Type the information you want to add to your report. Please don’t include other people’s phone numbers.')] },
  async TIPS_STAGE() { return prompts.SAFETY_MENU() },
  async AREA_QUERY() { return [text('Which area? Type a place, e.g. _Sea Point_, _V&A Waterfront_ or _airport_ — or share your location 📎.')] },
  async ROUTE_FROM() { return [text('Where does the trip start? e.g. _airport_')] },
  async ROUTE_TO() { return [text('And where are you going? e.g. _Sea Point_')] },
  async ALERT_AREA() { return [text('For which area would you like alerts? Type a place, e.g. _V&A Waterfront_, or share your location 📎.')] },
  async ALERT_CONSENT(ctx) {
    return [buttons(`You would receive WhatsApp alerts about *${ctx.alertPlace.name}* (within 3 km) for 14 days:\n\n• only incidents verified by the SafeArrival safety team and official SafeArrival advisories (never unverified reports);\n• you can stop them any time by typing *stop alerts*.\n\nDo you agree to receive these alerts?`,
      [['alert:yes', 'Yes, send alerts'], ['alert:no', 'No thanks']])]
  },
  async GUIDANCE_NEXT() { return [buttons('Would you like to report this to the SafeArrival safety team?', [['emg:report', 'Report this'], ['ask', 'Ask a question'], ['menu', 'Main menu']])] },
  async EMERGENCY_NEXT() {
    return [buttons('When you are able to: would you like the SafeArrival safety team to record this and follow up?', [['emg:report', 'Yes, record it'], ['emg:safe', 'I am safe'], ['menu', 'Main menu']])]
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

// ---------------------------------------------------------------- shared tools (same SQL as MCP)
async function tool(api, name, args) {
  const r = await api.tool(name, args)
  if (!r?.ok) throw new Error(r?.code === 'rate_limited' ? r.error : `I couldn’t get that information right now (${r?.error ?? 'no response'}). Please try again in a moment`)
  return r.data
}

/** Visitor-facing classification of public incident records, oldest-age shown, nothing invented. */
function classify(items, max = 3) {
  const out = []
  for (const type of ['safety_advisory', 'verified_incident', 'unverified_report']) {
    const rows = items.filter((x) => x.type === type)
    if (!rows.length) continue
    out.push(`${CLASS[type]} (${rows.length})`)
    for (const x of rows.slice(0, max)) {
      const where = x.location?.area_name ? ` · ${x.location.area_name.split(' · ')[0]}` : x.location?.distance_km != null ? ` · ~${x.location.distance_km} km away` : ''
      const dates = type === 'unverified_report'
        ? `reported ${day(x.reported_at)} (${ago(x.reported_at)}), not yet confirmed`
        : `reported ${day(x.reported_at)}, reviewed ${day(x.verified_at)}, updated ${day(x.last_updated)}${x.review_status === 'expired' ? ' — EXPIRED, historical only' : x.public_until ? `, current until ${day(x.public_until)}` : ''}`
      out.push(`• ${x.summary}${where}\n   _${dates} · ${x.source}_`)
    }
    if (rows.length > max) out.push(`   …and ${rows.length - max} more`)
  }
  return out.join('\n')
}

async function placeFrom(input, ctx, api) {
  if (input.location) return { name: input.location.name ?? 'your shared location', lat: input.location.lat, lng: input.location.lng }
  const t = input.text ?? ''
  if (/\bmy (hotel|accommodation|lodge|guest ?house)\b/i.test(t) && ctx.hotelName) {
    const h = (await api.hotels()).find((x) => x.slug === ctx.hotelSlug)
    if (h) return api.resolvePlace(h.area)
  }
  return api.resolvePlace(t)
}

async function areaReport(place, ctx, api) {
  const r = await tool(api, 'check_area_safety', { latitude: place.lat, longitude: place.lng, radius_km: 2, period_days: 90, location_name: place.name })
  const head = `📍 *${place.name}* — SafeArrival records within 2 km, last 90 days`
  const body = r.reports.length ? classify(r.reports)
    : 'SafeArrival has no reports or advisories for this area in the last 90 days. *That does not mean the area is safe*; it only means nothing has been reported to SafeArrival.'
  const cov = r.coverage?.covered ? '' : `\n\n${r.coverage?.note ?? ''}`
  const tips = `\n\nWhat you can do:\n• ${r.guidance.slice(0, 2).join('\n• ')}`
  const lim = '\n\n_SafeArrival covers traveller reports about transport and accommodation, not general crime. Locations are approximate. We never rate an area as safe or dangerous._'
  return { next: 'ANSWERED', ctx: { ...ctx, lastPlace: place }, replies: [text(`${head}\n\n${body}${cov}${tips}${lim}${demo(r)}`.slice(0, 4000))] }
}

async function routeReport(from, to, ctx, api) {
  const r = await tool(api, 'check_route_safety', { origin_latitude: from.lat, origin_longitude: from.lng, destination_latitude: to.lat, destination_longitude: to.lng, corridor_km: 1, period_days: 90 })
  const body = r.reports_near_route.length ? classify(r.reports_near_route)
    : 'SafeArrival has no reports near this route in the last 90 days. *That does not mean the route is safe.*'
  const msg = `🛣️ *${from.name} → ${to.name}* (about ${r.route_model.straight_line_km} km in a straight line)\n\n${body}\n\n_${r.route_model.note}_\n\nPrecautions:\n• ${r.precautions.join('\n• ')}\n\n_No live traffic or crime data is used. SafeArrival cannot guarantee that any route is safe._${demo(r)}`
  return { next: 'ANSWERED', ctx: { ...ctx, routeFrom: null, lastPlace: to }, replies: [text(msg.slice(0, 4000))] }
}

async function currentAlerts(ctx, api) {
  const r = await tool(api, 'get_safety_alerts', { days: 30, include_unverified: false })
  const body = r.alerts.length ? classify(r.alerts, 5) : 'There are no verified incidents or SafeArrival advisories in the last 30 days.'
  return { next: 'ANSWERED', replies: [text(`*Current SafeArrival alerts* (verified incidents and advisories, last 30 days)\n\n${body}\n\n_Unverified traveller reports are not included here. Type *get alerts* to receive alerts for an area._${demo(r)}`.slice(0, 4000))] }
}

async function pickupGuidance(ctx, api) {
  const r = await tool(api, 'get_pickup_guidance', { hotel: ctx.hotelSlug ?? '' })
  const p = r.pickup_point
  const where = p ? `*${p.name}*\n${p.meeting_instructions}\n\n` : ''
  return { next: 'ANSWERED', replies: [text(`${where}*How to check your driver*\n• ${r.verification_instructions.join('\n• ')}\n\n*Watch out for*\n• ${r.impersonation_warnings.join('\n• ')}${demo(r)}`)] }
}

async function emergencyServices(ctx, api) {
  let more = ''
  try {
    const r = await tool(api, 'find_emergency_services', {})
    more = `\n\n*Other numbers* (from SafeArrival’s reviewed list, updated ${day(r.last_updated)}):\n${r.emergency_numbers.filter((n) => !['10111', '10177', '112'].includes(n.number)).map((n) => `• ${n.name}: ${n.number}`).join('\n')}`
  } catch { /* the core numbers above are enough */ }
  return { next: 'ANSWERED', replies: [text(EMERGENCY + more + '\n\nYou can also type any question, e.g. _what should I do if my driver asks for extra money?_')] }
}

async function travelAdvice(t, ctx, api) {
  const c = /\bnight|dark|late\b/i.test(t) ? 'night' : /\b(airport|arriv\w*|land(ing)?)\b/i.test(t) ? 'airport_arrival' : /\b(uber|bolt|e-?hail\w*|ride ?app)\b/i.test(t) ? 'ehailing'
    : /\bshuttle\b/i.test(t) ? 'shuttle' : /\b(hik\w*|mountain|beach|outdoors?)\b/i.test(t) ? 'outdoors' : null
  if (!c) return { next: 'SAFETY_MENU' }
  const r = await tool(api, 'get_travel_safety_advice', { travel_context: c, destination: 'Cape Town' })
  return { next: 'ANSWERED', replies: [text(`${r.precautions.slice(0, 4).map((p) => `*${p.title}*\n${p.advice}`).join('\n\n')}\n\nIn an emergency call 10111 (police), 10177 (ambulance) or 112 from a mobile.${demo(r)}`)] }
}

async function subscribeAlerts(ctx, api) {
  const p = ctx.alertPlace
  const r = await tool(api, 'subscribe_safety_alerts', { consent: true, latitude: p.lat, longitude: p.lng, radius_km: 3, duration_days: 14, location_name: p.name.slice(0, 80),
    ...(ctx.phone ? { channel: 'whatsapp', whatsapp_number: ctx.phone } : { channel: 'web' }) })
  const token = r.manage_url.split('/alerts/')[1]
  const delivery = r.whatsapp_delivery && r.whatsapp_delivery !== 'enabled'
    ? `\n\n⚠️ WhatsApp alert delivery is ${r.whatsapp_delivery}. Until then, alerts appear on your manage page.` : ''
  return { next: 'ANSWERED', ctx: { ...ctx, alertPlace: null, alertTokens: [token, ...(ctx.alertTokens ?? [])].slice(0, 5) },
    replies: [text(`✅ Alerts set up for *${r.area}* until ${day(r.expires_at)} (ref ${r.reference}).\n\nManage, pause or stop them here (keep this link private): ${r.manage_url}${delivery}${demo(r)}`)] }
}

async function stopAlerts(ctx, api) {
  if (!ctx.alertTokens?.length) return { next: 'ANSWERED', replies: [text('There are no alert subscriptions from this chat. If you subscribed elsewhere, use the manage link you were given.')] }
  for (const tok of ctx.alertTokens) await tool(api, 'manage_safety_alerts', { manage_token: tok, action: 'unsubscribe' })
  return { next: 'ANSWERED', ctx: { ...ctx, alertTokens: [] }, replies: [text('Done. Your SafeArrival alerts have been stopped and your number removed from them.')] }
}

// ---------------------------------------------------------------- incident drafts
// One draft per conversation in ctx.report; nothing else writes to it, so a question asked
// mid-report never loses what was collected.
const serviceOf = (c) => (ACC_IDS.includes(c) ? 'accommodation' : ['stranded', 'medical_emergency', 'personal_safety'].includes(c) ? 'general' : 'transport')
const draft = (ctx, o) => ({ key: newKey(), ...(ctx.report ?? {}), ...o })

/** The next question for the draft: one at a time, skipping anything already known. */
function nextStep(ctx) {
  const d = ctx.report
  if (!d.category) return d.service ? 'INCIDENT_CATEGORY' : 'REPORT_SERVICE'
  if (d.description === undefined) return 'INCIDENT_DESCRIPTION'
  if (d.location === undefined) return 'INCIDENT_LOCATION'
  if (d.urgent === undefined) return 'INCIDENT_URGENT'
  return 'INCIDENT_CONFIRM'
}
const step = (ctx, replies = []) => ({ next: nextStep(ctx), ctx, replies })

async function startConcern(category, t, ctx, api) {
  const info = await api.categoryInfo(category)
  const c = { ...ctx, paused: null, report: draft({}, { service: serviceOf(category), category, description: t.trim().slice(0, 2000),
    location: serviceOf(category) === 'transport' && ctx.bookingToken ? ctx.pickupName ?? undefined : undefined,
    urgent: category === 'medical_emergency' ? true : undefined }) }
  const replies = []
  if (category === 'medical_emergency') replies.push(text(EMERGENCY))
  replies.push(text(`${info.label}.\n\n${info.precaution}${['driver_mismatch', 'vehicle_mismatch', 'code_incorrect'].includes(category) ? '\n\n*Please do not get into the vehicle.*' : ''}\n\nI can record this for the SafeArrival safety team. A few short questions (type *menu* to stop):`))
  return step(c, replies)
}

async function submitIncident(ctx, api) {
  const d = ctx.report
  const acc = d.service === 'accommodation'
  const r = await api.reportIncident({ booking_token: d.service === 'transport' ? ctx.bookingToken : null, hotel_slug: ctx.hotelSlug, category: d.category,
    description: d.description || null, needs_immediate_help: !!d.urgent, location_text: d.location || null, idempotency_key: d.key,
    visitor_safe: d.urgent === undefined ? null : !d.urgent, contact_whatsapp: ctx.phone,
    subject_name: acc ? d.subjectName : null, subject_hotel_slug: acc ? d.subjectSlug : null })
  const msgs = [text(`Your report has been received.\n\nReference: *${r.reference}*\n\n${acc ? 'Our safety team will review it. ' : d.service === 'transport' && ctx.bookingToken ? 'Your hotel has been notified. ' : 'The SafeArrival safety team will review it. '}We will keep you updated as your report progresses. Type *check my report* any time to see updates, add information, or tell us you are safe.\nTrack it here: ${api.incidentLink(r.access_token)}\n\nThis is an internal reference, not a police case number.`)]
  if (d.urgent) msgs.unshift(text(EMERGENCY))
  const c = { ...ctx, report: null, paused: null, lastIncidentToken: r.access_token,
    incidentTokens: [...new Set([r.access_token, ...(ctx.incidentTokens ?? [])])].slice(0, 5) }
  // Never ask for feedback when the visitor said they need help now.
  const ask = !d.urgent && offer(c, { service: 'incident', flow: 'incident', incident_token: r.access_token, label: 'report' })
  return { next: ask ? 'FEEDBACK_ASK' : 'ANSWERED', ctx: c, replies: msgs }
}

// ---------------------------------------------------------------- handlers
// Each returns { next, ctx?, replies? } or { invalid: 'message' }.
async function viewBooking(ctx, api) {
  if (!ctx.bookingToken) return { next: 'NO_BOOKING' }
  const t = await api.getTrip(ctx.bookingToken)
  const b = t.booking
  const lines = [`*${b.reference}* — ${api.statusLabel(b.status)}`, `🕑 ${api.fmtTime(b.pickup_at)}`, `📍 ${t.pickup_point.name}`, `🚐 ${t.provider?.name ?? 'Provider to be confirmed'}`, `💰 ${api.priceText(b)}`]
  if (t.driver) lines.push(`\n👤 ${t.driver.full_name}\n🚗 ${t.driver.colour} ${t.driver.make} ${t.driver.model} · ${t.driver.registration}`)
  lines.push(`\nFull details & map: ${api.tripLink(ctx.bookingToken)}`)
  const verifying = ['driver_assigned', 'driver_on_way', 'driver_arrived'].includes(b.status)
  return { next: verifying ? 'VERIFICATION' : b.status === 'in_progress' || b.status === 'completed' ? 'COMPLETED' : 'BOOKED', replies: [text(lines.join('\n'))] }
}

async function startVerify(ctx, api) {
  if (!ctx.bookingToken) return { next: 'NO_BOOKING', replies: [text('You don’t have a booking with us yet, so there’s no driver to verify. If someone says they are your driver, do not go with them. Type *pickup guidance* for how to check any driver.')] }
  const t = await api.getTrip(ctx.bookingToken)
  if (!['driver_assigned', 'driver_on_way', 'driver_arrived'].includes(t.booking.status)) {
    return { next: 'BOOKED', replies: [text(t.booking.status === 'in_progress' || t.booking.status === 'completed' ? 'Your driver is already verified.' : 'Your driver hasn’t been assigned yet. We’ll message you their details and your verification code as soon as they are. *If anyone approaches you claiming to be your driver before then, do not go with them.*')] }
  }
  return { next: 'VERIFICATION' }
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
    if (m.verified_reports_90_days) l.push(`${m.verified_reports_90_days} verified report(s) in the last 90 days.`)
    l.push(`_Status last changed ${day(m.status_last_changed)}._`)
    return l.join('\n')
  })
  const top = r.matches[0]
  const msg = [...(r.matches.length ? [] : [`We have no record of “${name}”.`]), ...lines, ...r.warnings.map((w) => `⚠️ ${w}`),
    `\nTips:\n• ${r.guidance.slice(0, 2).join('\n• ')}`, `\n_Partner status means we hold verified contact details; it is not a guarantee of safety._`].join('\n\n')
  const c = { ...ctx, lastCheck: { service: 'accommodation', subjectName: top?.name ?? name, subjectSlug: top?.slug ?? null } }
  offer(c, { service: 'accommodation', flow: 'accom_check', hotel_slug: top?.slug, label: 'accommodation check', returnTo: 'MENU' }, false)
  return { next: 'CHECK_DONE', ctx: c, replies: [text(msg + demo(r))] }
}

async function providerCheck(t, ctx, api) {
  const name = t.trim().replace(/^(check|verify|is)\s+/i, '').replace(/\s+(legit|real|a partner|ok)\??$/i, '')
  if (name.length < 3) return { invalid: 'Please type at least 3 letters of the company’s name.' }
  const r = await api.checkProvider({ provider_name: name.slice(0, 120) })
  const lines = r.matches.slice(0, 3).map((m) => [`*${m.name}* — ${PARTNER[m.safearrival_status] ?? m.safearrival_status}`, m.meaning,
    m.contacts ? `📞 ${m.contacts.phone ?? '—'}${m.contacts.safety_contact ? `\n🛡️ Safety contact: ${m.contacts.safety_contact}` : ''}` : null,
    m.service_coverage?.length ? `Areas: ${m.service_coverage.join(', ')}` : null, `_Status last changed ${day(m.status_last_changed)}._`].filter(Boolean).join('\n'))
  const msg = [...(lines.length ? lines : [`“${name}” is not a SafeArrival partner.`]), r.note,
    'Whoever the company is, the driver should match your booking. With a SafeArrival booking, the driver must say your code first.'].join('\n\n')
  const top = r.matches[0]
  const c = { ...ctx, lastCheck: { service: 'transport', subjectName: top?.name ?? name } }
  offer(c, { service: 'transport', flow: 'provider_check', provider_id: top?.provider_id, label: 'transport company check', returnTo: 'MENU' }, false)
  return { next: 'CHECK_DONE', ctx: c, replies: [text(msg + demo(r))] }
}

async function showReports(tokens, ctx, api) {
  const out = []; let followedUp = null; let open = null
  for (const tok of tokens.slice(0, 3)) {
    const r = await api.getIncident(tok)
    const i = r.incident
    const latest = r.updates.slice(-2).map((u) => `• ${u.message}`).join('\n')
    out.push(`*${i.reference}* — ${INCIDENT_STATUS[i.status] ?? i.status}\nReported ${api.fmtTime(i.created_at)} · last update ${api.fmtTime(i.updated_at)}\n${latest}`)
    if (!followedUp && ['follow_up', 'escalated', 'referred_authorities', 'resolved', 'closed'].includes(i.status)) followedUp = tok
    if (!open && i.status !== 'closed') open = tok
  }
  const c = { ...ctx, incidentTokens: [...new Set([...tokens, ...(ctx.incidentTokens ?? [])])].slice(0, 5), lastIncidentToken: open ?? ctx.lastIncidentToken }
  const replies = [text(`${out.join('\n\n')}\n\nThese are SafeArrival references, not police case numbers. In an emergency call 10111 or 112.`)]
  // An open case gets the follow-up buttons; the feedback offer is remembered, and only asked when nothing is open.
  const ask = followedUp && offer(c, { service: 'incident', flow: 'incident_followup', incident_token: followedUp, label: 'report follow-up' }, !open)
  return { next: open ? 'REPORT_FOLLOWUP' : ask ? 'FEEDBACK_ASK' : 'ANSWERED', ctx: c, replies }
}

async function followup(kind, msg, ctx, api) {
  const r = await api.followup(ctx.lastIncidentToken, kind, msg ?? null)
  const reply = kind === 'info' ? `Thank you. Your information was added to report *${r.reference}*.`
    : kind === 'safe' ? `Thank you for letting us know you are safe. Report *${r.reference}* stays open until the safety team has finished with it.`
      : `The safety team has been told you need more help with *${r.reference}*. They will contact you here as soon as possible.\n\n${EMERGENCY}`
  return { next: 'ANSWERED', replies: [text(reply)] }
}

const HOW = 'How SafeArrival works:\n\n1. *Check before you go*: ask about an accommodation, transport company, area or route. Answers come from records the SafeArrival / Cape Town Tourism safety team maintains.\n2. *Trusted pickups*: partner hotels arrange transport; you get the driver’s name, photo, vehicle and a private code.\n3. *Verify the driver*: the driver must say your code first. If anything doesn’t match, don’t get in.\n4. *Report concerns*: you get a reference and updates here. Reports stay *unverified* until the safety team reviews them.\n\nSafeArrival is not an emergency service: call 10111 or 112 in danger.'

/** Route a recognised intent. Returns null when the intent has no action here. */
async function route({ intent, category, kind }, input, ctx, api) {
  const t = input.text ?? ''
  switch (intent) {
    case 'MAIN_MENU': return { next: 'WELCOME', ctx: { ...ctx, option: null, fb: null } }
    case 'EMERGENCY': return { next: 'EMERGENCY_NEXT', ctx: { ...ctx, emergency: { category, text: t.slice(0, 2000) } }, replies: [text(EMERGENCY)] }
    case 'HUMAN_SUPPORT':
      return { next: 'ANSWERED', replies: [text(`A person can help. ${ctx.hotelName ? `Call ${ctx.hotelName}'s front desk${ctx.hotelPhone ? ` on ${ctx.hotelPhone}` : ''}` : 'Your hotel front desk can help directly'}, or reply here and our safety team will follow up during support hours.${ctx.lastIncidentToken ? ' If it is about your report, type *I need more help* and the team handling it will be alerted.' : ''}\n\nIn an emergency call 10111 or 112.`)] }
    case 'HOW_IT_WORKS': return { next: 'ANSWERED', replies: [text(HOW)] }
    case 'INCIDENT_FOLLOWUP':
      return kind === 'info' ? { next: 'FOLLOWUP_INFO' } : followup(kind, null, ctx, api)
    case 'INCIDENT_STATUS': return handlers.MENU({ id: 'status' }, ctx, api)
    case 'ALERT_MANAGEMENT': return stopAlerts(ctx, api)
    case 'ALERT_SUBSCRIPTION': {
      const p = await placeFrom(input, ctx, api) ?? ctx.lastPlace
      return p ? { next: 'ALERT_CONSENT', ctx: { ...ctx, alertPlace: p } } : { next: 'ALERT_AREA' }
    }
    case 'ROUTE_SAFETY': {
      const m = t.match(/\bfrom (.+?) to (.+?)[?.!]*$/i)
      const [from, to] = m ? await Promise.all([api.resolvePlace(m[1]), api.resolvePlace(m[2])]) : []
      if (from && to) return routeReport(from, to, ctx, api)
      return from ? { next: 'ROUTE_TO', ctx: { ...ctx, routeFrom: from } } : { next: 'ROUTE_FROM' }
    }
    case 'AREA_SAFETY': {
      const p = await placeFrom(input, ctx, api)
      return p ? areaReport(p, ctx, api) : { next: 'AREA_QUERY' }
    }
    case 'SAFETY_ALERTS': return currentAlerts(ctx, api)
    case 'INCIDENT_REPORT': return category ? startConcern(category, t, ctx, api) : handlers.MENU({ id: 'wrong' }, ctx, api)
    case 'SAFETY_GUIDANCE': {
      if (!category) return travelAdvice(t, ctx, api)
      const info = await api.categoryInfo(category)
      return { next: 'GUIDANCE_NEXT', ctx: { ...ctx, emergency: { category, text: '' } },
        replies: [text(`*${info.label}*\n\n${info.precaution}\n\nIf you are in danger call 10111 (police) or 112 from a mobile.`)] }
    }
    case 'DRIVER_VERIFICATION': return startVerify(ctx, api)
    case 'TRANSPORT_PROVIDER_CHECK': return { next: 'PROVIDER_QUERY' }
    case 'ACCOMMODATION_CHECK': return { next: 'ACCOM_QUERY' }
    case 'PICKUP_GUIDANCE': return pickupGuidance(ctx, api)
    case 'BOOKING_LOOKUP': return viewBooking(ctx, api)
    case 'BOOK_TRANSPORT': return handlers.MENU({ id: 'arrange' }, ctx, api)
    case 'EMERGENCY_SERVICES': return emergencyServices(ctx, api)
    case 'FEEDBACK': return handlers.MENU({ id: 'feedback' }, ctx, api)
    default: return null
  }
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
    replies: [text(`Thank you for your feedback! 🙏${negative ? '\n\nI’m sorry it wasn’t better. Feedback is anonymous and isn’t a report: if something unsafe happened, choose *Report a concern* so our safety team can follow up.' : ''}`)] }
}

const place = (fn) => async (input, ctx, api) => {
  if (!input.text && !input.location) return { invalid: 'Type a place name or share your location.' }
  const p = await placeFrom(input, ctx, api)
  return p ? fn(p, ctx, api) : { invalid: 'I don’t know that place yet. Try a nearby landmark or suburb (e.g. _Sea Point_, _airport_, _V&A Waterfront_), or share your location.' }
}

const handlers = {
  async MENU({ id, text: t }, ctx, api) {
    if (!id && /^\d{1,2}$/.test(t?.trim() ?? '')) id = MENU_ROWS[+t.trim() - 1]?.[0] // "3" picks the third row
    if (id === 'area') return { next: 'AREA_QUERY' }
    if (id === 'route') return { next: 'ROUTE_FROM' }
    if (id === 'arrange') return { next: ctx.hotelSlug ? 'PICKUP' : 'HOTEL_SELECTION', replies: ctx.hotelSlug ? [text(`Booking with *${ctx.hotelName}*.`)] : [] }
    if (id === 'view') return viewBooking(ctx, api)
    if (id === 'verify') return startVerify(ctx, api)
    if (id === 'wrong' || id === 'report') return { next: 'REPORT_SERVICE', ctx: { ...ctx, paused: null, report: draft({}, {}) } }
    if (id === 'accom') return { next: 'ACCOM_QUERY' }
    if (id === 'provider') return { next: 'PROVIDER_QUERY' }
    if (id === 'status') return ctx.incidentTokens?.length ? showReports(ctx.incidentTokens, ctx, api) : { next: 'STATUS_QUERY' }
    if (id === 'tips') return { next: 'SAFETY_MENU' }
    if (id === 'feedback') return ctx.feedbackOffer ? startFeedback(ctx, api) : { next: 'FEEDBACK_PICK' }
    if (id === 'emergency') return emergencyServices(ctx, api)
    if (id === 'ask') return { next: 'ASK' }
    return { invalid: 'Please choose an option from the menu, or type your question.' }
  },
  async ANSWERED(input, ctx, api) { return handlers.MENU(input, ctx, api) },
  async ASK({ id }, ctx, api) { return id ? handlers.MENU({ id }, ctx, api) : { invalid: 'Type your question.' } },
  async NO_BOOKING(input, ctx, api) { return handlers.MENU(input, ctx, api) },
  async SAFETY_MENU({ id }, ctx, api) {
    if (id?.startsWith('tips:')) return handlers.TIPS_STAGE({ id }, ctx, api)
    if (id === 'alerts') return currentAlerts(ctx, api)
    if (id === 'subscribe') return ctx.lastPlace ? { next: 'ALERT_CONSENT', ctx: { ...ctx, alertPlace: ctx.lastPlace } } : { next: 'ALERT_AREA' }
    if (id === 'stopalerts') return stopAlerts(ctx, api)
    if (id === 'pickup') return pickupGuidance(ctx, api)
    return handlers.MENU({ id }, ctx, api)
  },
  AREA_QUERY: place(areaReport),
  ROUTE_FROM: place(async (p, ctx) => ({ next: 'ROUTE_TO', ctx: { ...ctx, routeFrom: p } })),
  ROUTE_TO: place((p, ctx, api) => routeReport(ctx.routeFrom, p, ctx, api)),
  ALERT_AREA: place(async (p, ctx) => ({ next: 'ALERT_CONSENT', ctx: { ...ctx, alertPlace: p } })),
  async ALERT_CONSENT({ id, text: t }, ctx, api) {
    if (!id && t) id = /^(yes|y|yes please|i agree|agree|ok)\b/i.test(t.trim()) ? 'alert:yes' : /^(no|n|no thanks)\b/i.test(t.trim()) ? 'alert:no' : null
    if (id === 'alert:yes') return subscribeAlerts(ctx, api) // explicit consent: only this tap subscribes
    if (id === 'alert:no') return { next: 'ANSWERED', ctx: { ...ctx, alertPlace: null }, replies: [text('No problem, no alerts were set up.')] }
    return { invalid: 'Please tap Yes or No.' }
  },
  async EMERGENCY_NEXT({ id }, ctx, api) {
    const e = ctx.emergency ?? {}
    if (id === 'emg:report') {
      const c = { ...ctx, emergency: null, paused: null, report: draft({}, { service: serviceOf(e.category ?? 'personal_safety'), category: e.category ?? 'personal_safety',
        description: e.text || undefined, urgent: e.text ? true : undefined }) }
      return step(c)
    }
    if (id === 'emg:safe') return { next: 'ANSWERED', ctx: { ...ctx, emergency: null }, replies: [text('I’m glad you are safe. If anything changes, message us or call 10111 / 112.')] }
    return handlers.MENU({ id }, { ...ctx, emergency: null }, api)
  },
  async GUIDANCE_NEXT(input, ctx, api) { return handlers.EMERGENCY_NEXT(input, ctx, api) },
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
  async BOOKED({ id, text: t }, ctx, api) {
    if (id === 'view') return viewBooking(ctx, api)
    if (id === 'verify') return startVerify(ctx, api)
    return handlers.MENU({ id, text: t }, ctx, api)
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
    const c = { ...ctx, paused: null, report: draft({}, { service: 'transport', category: OUTCOME_CATEGORY[outcome], location: ctx.pickupName }) }
    return step(c, [text('*Do not enter the vehicle.* Stay inside the terminal or another busy public place. Your hotel and the transport provider are alerted when you submit this report.')])
  },
  async REPORT_SERVICE({ id }, ctx) {
    if (id === 'rs:transport' || id === 'rs:accommodation') return step({ ...ctx, report: draft(ctx, { service: id.slice(3), category: undefined }) })
    if (id === 'rs:personal') return { next: 'INCIDENT_CATEGORY', ctx: { ...ctx, report: draft(ctx, { service: 'general', category: undefined }) } }
    return { invalid: 'Please tap Transport, Accommodation or My personal safety.' }
  },
  async INCIDENT_CATEGORY({ id }, ctx) {
    const cats = ctx.report?.service === 'accommodation' ? ACC_CATEGORIES : CATEGORIES
    const c = cats.find(([k]) => `cat:${k}` === id)
    return c ? step({ ...ctx, report: { ...ctx.report, category: c[0], service: serviceOf(c[0]) } }) : { invalid: 'Please choose what happened from the list.' }
  },
  async INCIDENT_DESCRIPTION({ id, text: t }, ctx) {
    if (id === 'skip') return step({ ...ctx, report: { ...ctx.report, description: '' } })
    if (!t?.trim()) return { invalid: 'Type a short description, or tap Skip.' }
    return step({ ...ctx, report: { ...ctx.report, description: t.trim().slice(0, 2000) } })
  },
  async INCIDENT_LOCATION(input, ctx) {
    const loc = input.id === 'skip' ? '' : input.location ? `${input.location.name ? `${input.location.name}, ` : ''}~${(+input.location.lat).toFixed(2)}, ${(+input.location.lng).toFixed(2)}` : input.text?.trim().slice(0, 200)
    if (loc === undefined || (loc === '' && input.id !== 'skip')) return { invalid: 'Type where it happened, or tap Skip.' }
    return step({ ...ctx, report: { ...ctx.report, location: loc } })
  },
  async INCIDENT_URGENT({ id, text: t }, ctx) {
    if (!id && t) id = /\b(no|not safe|unsafe|help|danger)\b/i.test(t) ? 'urgent:yes' : /\b(yes|safe|ok|okay|fine)\b/i.test(t) ? 'urgent:no' : null
    if (id !== 'urgent:yes' && id !== 'urgent:no') return { invalid: 'Please tap Yes or No.' }
    const urgent = id === 'urgent:yes'
    return step({ ...ctx, report: { ...ctx.report, urgent } }, urgent ? [text(EMERGENCY)] : [])
  },
  async INCIDENT_CONFIRM({ id, text: t }, ctx, api) {
    if (!id && t) id = /^(yes|y|submit|confirm|send)\b/i.test(t.trim()) ? 'submit' : /^(no|n|cancel)\b/i.test(t.trim()) ? 'cancel' : null
    if (id === 'submit') return submitIncident(ctx, api) // explicit confirmation: only this tap submits
    if (id === 'edit') return { next: 'REPORT_SERVICE', ctx: { ...ctx, report: { ...ctx.report, category: undefined, description: undefined, location: undefined } } }
    if (id === 'cancel') return { next: 'ANSWERED', ctx: { ...ctx, report: null }, replies: [text('Your report was not submitted. If you are in danger, call 10111 or 112.')] }
    return { invalid: 'Please tap Yes, submit / Change details / No, cancel.' }
  },
  async COMPLETED(input, ctx, api) { return handlers.BOOKED(input, ctx, api) },
  async ACCOM_QUERY({ id, text: t }, ctx, api) { return t && !id ? accommodationCheck(t, ctx, api) : { invalid: 'Type the accommodation’s name.' } },
  async PROVIDER_QUERY({ id, text: t }, ctx, api) { return t && !id ? providerCheck(t, ctx, api) : { invalid: 'Type the company’s name.' } },
  async CHECK_DONE({ id, text: t }, ctx, api) {
    if (id === 'report') {
      const l = ctx.lastCheck ?? {}
      return step({ ...ctx, paused: null, report: draft({}, { service: l.service ?? 'transport', subjectName: l.subjectName, subjectSlug: l.subjectSlug }) })
    }
    return handlers.MENU({ id, text: t }, ctx, api)
  },
  async STATUS_QUERY({ text: t = '' }, ctx, api) {
    const tok = t.match(/[0-9a-f]{20,64}/i)?.[0]?.toLowerCase()
    if (!tok) return { invalid: 'I couldn’t find a tracking code in that. Paste the full tracking link from your report message.' }
    try { await api.getIncident(tok) } catch { return { invalid: 'No report matches that tracking code.' } }
    return showReports([tok], ctx, api)
  },
  async REPORT_FOLLOWUP({ id, text: t }, ctx, api) {
    if (id === 'fu:info') return { next: 'FOLLOWUP_INFO' }
    if (id === 'fu:safe' || id === 'fu:help') return followup(id.slice(3), null, ctx, api)
    return handlers.MENU({ id, text: t }, ctx, api)
  },
  async FOLLOWUP_INFO({ text: t }, ctx, api) {
    if (!t?.trim() || t.trim().length < 3) return { invalid: 'Type the information you want to add.' }
    return followup('info', t.trim(), ctx, api)
  },
  async TIPS_STAGE({ id }, ctx, api) {
    const stage = id?.startsWith('tips:') && id.slice(5)
    if (!['before_arrival', 'during_visit', 'after_incident'].includes(stage)) return handlers.SAFETY_MENU({ id }, ctx, api)
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

// States where typed text is normally the ANSWER, not a new request.
const TYPING = ['INCIDENT_DESCRIPTION', 'INCIDENT_LOCATION', 'NAME', 'PHONE', 'ARRIVAL_DATE', 'ARRIVAL_TIME', 'ACCOM_QUERY', 'PROVIDER_QUERY',
  'STATUS_QUERY', 'FOLLOWUP_INFO', 'AREA_QUERY', 'ROUTE_FROM', 'ROUTE_TO', 'ALERT_AREA', 'VERIFICATION']
// ...and where even "hi" or "menu" is part of what they are writing.
const PROSE = ['INCIDENT_DESCRIPTION', 'NAME', 'FOLLOWUP_INFO']
const prose = (state, ctx) => PROSE.includes(state) || (state === 'FEEDBACK' && FB_Q[fbQuestion(ctx)]?.[0] === 'comment')
const typing = (state, ctx) => TYPING.includes(state) || (state === 'FEEDBACK' && FB_Q[fbQuestion(ctx)]?.[0] === 'comment')
// Flows worth resuming if the visitor wanders off mid-way.
const PAUSABLE = { INCIDENT_DESCRIPTION: 'report', INCIDENT_LOCATION: 'report', INCIDENT_URGENT: 'report', INCIDENT_CONFIRM: 'report', INCIDENT_CATEGORY: 'report',
  REPORT_SERVICE: 'report', ARRIVAL_DAY: 'booking', ARRIVAL_DATE: 'booking', ARRIVAL_TIME: 'booking', PASSENGERS: 'booking', LUGGAGE: 'booking', NAME: 'booking',
  PHONE: 'booking', TRANSPORT_SELECTION: 'booking', BOOKING_CONFIRMATION: 'booking', PICKUP: 'booking' }

/** Decide what typed text means in this state. Returns a result, or null to let the state handler answer. */
async function interpret(state, input, ctx, api) {
  const t = input.text.trim()
  const intent = detectIntent(t, ctx)
  const answering = typing(state, ctx)
  if (intent.intent === 'MAIN_MENU') return prose(state, ctx) ? null : withPause(state, ctx, await route(intent, input, ctx, api))
  if (intent.intent === 'EMERGENCY' && !answering) return route(intent, input, ctx, api)
  if (intent.intent === 'GENERAL_QUESTION') return null
  // While answering a question, only a clear QUESTION about something else interrupts.
  if (answering && !(isQuestion(t) && !(state.startsWith('INCIDENT_') && intent.category))) return null
  // Pressing a button state with words: let the state handler try (e.g. "yes", "3", a typed code) first.
  if (!answering && ['FEEDBACK', 'ALERT_CONSENT', 'INCIDENT_CONFIRM', 'INCIDENT_URGENT'].includes(state) && !isQuestion(t)) return null
  return withPause(state, ctx, await route(intent, input, ctx, api))
}

/** Leaving an unfinished report or booking for another request: remember it so it can be resumed. */
function withPause(state, ctx, r) {
  if (!r || !PAUSABLE[state] || ctx.paused) return r
  const c = r.ctx ?? ctx
  if (PAUSABLE[state] === 'report' && c.report !== ctx.report) return r // a new report replaced it on purpose
  return { ...r, ctx: { ...c, paused: { state, label: PAUSABLE[state] } } }
}

/** Process one inbound message. Never throws: errors become a friendly reply. */
export async function handle(session, input, api) {
  let state = session?.state ?? 'WELCOME'
  let ctx = { ...(session?.ctx ?? {}) }
  const replies = []
  try {
    let result
    const t = input?.text && !input.id ? input.text : null
    if (input?.id === 'menu') result = { next: 'MENU', ctx: { ...ctx, fb: null } }
    else if (input?.id === 'fb:start') result = await startFeedback(ctx, api)
    else if (input?.id === 'resume' && ctx.paused) result = { next: ctx.paused.state, ctx: { ...ctx, paused: null } }
    else if (input?.id === 'discard') result = { next: home(ctx), ctx: { ...ctx, paused: null, report: null, option: null }, replies: [text('OK, discarded.')] }
    else if (input?.location && !['AREA_QUERY', 'ROUTE_FROM', 'ROUTE_TO', 'ALERT_AREA', 'INCIDENT_LOCATION'].includes(state)) {
      result = await areaReport({ name: input.location.name ?? 'your shared location', lat: input.location.lat, lng: input.location.lng }, ctx, api)
    } else if (t) {
      // Danger words never wait: the numbers go out first, whatever the state.
      if (typing(state, ctx) && EMERGENCY_RE.test(t)) replies.push(text(EMERGENCY))
      result = await interpret(state, input, ctx, api)
    }
    if (!result && (state === 'WELCOME' || !session)) result = { next: 'WELCOME' }
    if (!result) result = handlers[state] ? await handlers[state](input ?? {}, ctx, api) : { next: 'WELCOME' }
    // Words the state couldn't use: one more chance as a request, else ask to clarify.
    if (result.invalid && t && !typing(state, ctx) && !PAUSABLE[state]) {
      const r = await route(detectIntent(t, ctx), input, ctx, api)
      if (r) result = r
      else if (['MENU', 'ANSWERED', 'BOOKED', 'COMPLETED', 'NO_BOOKING', 'CHECK_DONE', 'SAFETY_MENU', 'REPORT_FOLLOWUP', 'ASK', 'GUIDANCE_NEXT', 'EMERGENCY_NEXT'].includes(state)) {
        result = { invalid: 'I can help with area and route checks, transport companies, accommodation, your booking and driver, safety advice and alerts, or reporting a concern. Could you say a little more, or choose from the menu?' }
        state = 'MENU'
      }
    }

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
    state = 'MENU'
    ctx = { ...ctx, fb: null }
  }
  return { session: { state, ctx }, replies }
}
