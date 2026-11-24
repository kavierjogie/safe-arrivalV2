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
//   tripLink(token), incidentLink(token)

export const STATES = ['WELCOME', 'MENU', 'HOTEL_SELECTION', 'PICKUP', 'ARRIVAL_DAY', 'ARRIVAL_DATE', 'ARRIVAL_TIME', 'PASSENGERS',
  'LUGGAGE', 'NAME', 'PHONE', 'TRANSPORT_SELECTION', 'BOOKING_CONFIRMATION', 'BOOKED', 'VERIFICATION', 'VERIFY_MORE',
  'INCIDENT_CATEGORY', 'INCIDENT_DESCRIPTION', 'INCIDENT_URGENT', 'COMPLETED']

const CATEGORIES = [
  ['driver_mismatch', 'Driver doesn’t match'], ['code_incorrect', 'Code incorrect'], ['vehicle_mismatch', 'Vehicle doesn’t match'],
  ['extra_payment', 'Asked to pay extra'], ['suspected_scam', 'Suspected scam'], ['intimidation', 'Threatened/intimidated'],
  ['cannot_locate_driver', 'Can’t find my driver'], ['other', 'Something else'],
]
const OUTCOME_CATEGORY = { code_mismatch: 'code_incorrect', details_mismatch: 'driver_mismatch', wrong_vehicle: 'vehicle_mismatch', cannot_find: 'cannot_locate_driver' }
const EMERGENCY = 'If you are in danger right now:\n🚓 Police (SAPS): 10111\n🚑 Ambulance: 10177\n📱 Any emergency from a mobile: 112\n\nMove to a busy, well-lit public area — inside the terminal if you are at the airport.'

const text = (t) => ({ type: 'text', text: t })
const buttons = (t, b) => ({ type: 'buttons', text: t, buttons: b.map(([id, title]) => ({ id, title: title.slice(0, 20) })) })
const list = (t, button, rows) => ({ type: 'list', text: t, button, rows: rows.slice(0, 10).map(([id, title, description]) => ({ id, title: title.slice(0, 24), description: description?.slice(0, 72) })) })
const rand = (n) => `R${Math.round(Number(n)).toLocaleString('en-ZA')}`
const price = (o) => (o.price_type === 'agreed' ? `${rand(o.price_amount)} agreed price` : o.price_type === 'estimate' ? `${rand(o.price_min)}–${rand(o.price_max)} estimate` : 'price confirmed by provider')

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

// ---------------------------------------------------------------- prompts
const prompts = {
  async WELCOME(ctx) {
    const back = ctx.bookingRef ? `\n\nWelcome back${ctx.name ? `, ${ctx.name.split(' ')[0]}` : ''}! Your booking is ${ctx.bookingRef}.` : ''
    return [
      text(`Welcome to Cape Town! 🌍\n\nWe're here to help you arrange trusted transport from your arrival point to your accommodation.${ctx.hotelName ? `\n\nYou're connected to *${ctx.hotelName}*.` : ''}${back}\n\nWith our service, you can:\n1. Arrange trusted transport.\n2. Verify your driver before entering the vehicle.\n3. See your agreed transport price.\n4. Report suspicious activity or problems.`),
      ...(await prompts.MENU(ctx)),
    ]
  },
  async MENU() {
    return [list('How can we help you today?', 'Choose an option', [
      ['arrange', 'Arrange transport', 'Book a trusted pickup to your accommodation'],
      ['view', 'View my booking', 'Status, price and driver details'],
      ['verify', 'Verify my driver', 'Check your driver before you get in'],
      ['wrong', 'Something’s wrong', 'Report a problem or a suspicious driver'],
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
  async INCIDENT_CATEGORY() { return [list('I’m sorry something is wrong. What happened?', 'Choose', CATEGORIES.map(([id, t]) => [`cat:${id}`, t]))] },
  async INCIDENT_DESCRIPTION() { return [buttons('Tell us briefly what happened and where you are (type a message), or skip.', [['skip', 'Skip']])] },
  async INCIDENT_URGENT() { return [buttons('Do you need immediate assistance?', [['urgent:yes', 'Yes, I need help now'], ['urgent:no', 'No, I am safe']])] },
  async COMPLETED() { return [buttons('Enjoy Cape Town! If anything goes wrong, message us any time.', [['wrong', 'Something’s wrong'], ['menu', 'Main menu']])] },
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
  const r = await api.reportIncident({ booking_token: ctx.bookingToken, hotel_slug: ctx.hotelSlug, category: ctx.category,
    description: ctx.description, needs_immediate_help: urgent, location_text: ctx.pickupName })
  const msgs = [text(`Your report has been received.\n\nReference: *${r.reference}*\n\n${ctx.bookingToken ? 'Your hotel has been notified. ' : ''}We will keep you updated as your report progresses.\nTrack it here: ${api.incidentLink(r.access_token)}\n\nThis is an internal reference, not a police case number.`)]
  if (urgent) msgs.unshift(text(EMERGENCY))
  return { next: ctx.bookingToken ? 'BOOKED' : 'MENU', ctx: { ...ctx, category: null, description: null, lastIncidentToken: r.access_token }, replies: msgs }
}

const handlers = {
  async MENU({ id }, ctx, api) {
    if (id === 'arrange') return { next: ctx.hotelSlug ? 'PICKUP' : 'HOTEL_SELECTION', replies: ctx.hotelSlug ? [text(`Booking with *${ctx.hotelName}*.`)] : [] }
    if (id === 'view') return viewBooking(ctx, api)
    if (id === 'verify') return startVerify(ctx, api)
    if (id === 'wrong') return { next: 'INCIDENT_CATEGORY' }
    if (id === 'emergency') return { next: ctx.bookingToken ? 'BOOKED' : 'MENU', replies: [text(EMERGENCY)] }
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
    if (id === 'wrong') return { next: 'INCIDENT_CATEGORY' }
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
    if (outcome === 'verified') return { next: 'COMPLETED', replies: [text('Driver verified ✅ Have a safe trip!')] }
    return { next: 'INCIDENT_DESCRIPTION', ctx: { ...ctx, category: OUTCOME_CATEGORY[outcome] },
      replies: [text('*Do not enter the vehicle.* Stay inside the terminal or another busy public place. We are alerting your hotel and the transport provider.')] }
  },
  async INCIDENT_CATEGORY({ id }, ctx) {
    const c = CATEGORIES.find(([k]) => `cat:${k}` === id)
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
}

const GLOBAL = [
  [/^(hi|hello|hey|start|menu|main menu|restart)\b/i, async (ctx) => ({ next: 'WELCOME', ctx: { ...ctx, category: null, option: null } })],
  [/\b(emergency|sos|police|ambulance|danger)\b/i, async (ctx) => ({ next: ctx.bookingToken ? 'BOOKED' : 'MENU', replies: [text(EMERGENCY)] })],
  [/\b(human|agent|person|staff|call me|speak to)\b/i, async (ctx) => ({ next: ctx.bookingToken ? 'BOOKED' : 'MENU',
    replies: [text(`A person can help. ${ctx.hotelName ? `Call ${ctx.hotelName}'s front desk${ctx.hotelPhone ? ` on ${ctx.hotelPhone}` : ''}` : 'Your hotel front desk can help directly'}, or reply here and our safety team will follow up during support hours.\n\nIn an emergency call 10111 or 112.`)] })],
]

/** Process one inbound message. Never throws: errors become a friendly reply. */
export async function handle(session, input, api) {
  let state = session?.state ?? 'WELCOME'
  let ctx = { ...(session?.ctx ?? {}) }
  const replies = []
  try {
    let result
    if (input?.id === 'menu') result = { next: 'MENU' }
    else if (input?.text && !input.id) {
      const g = GLOBAL.find(([re]) => re.test(input.text.trim()))
      if (g && !['INCIDENT_DESCRIPTION', 'NAME'].includes(state)) result = await g[1](ctx)
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
  }
  return { session: { state, ctx }, replies }
}
