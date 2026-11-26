// Supabase Edge Function: WhatsApp Business Cloud API (Meta) integration.
//
//   GET  /whatsapp-webhook             Meta webhook verification (hub.challenge)
//   POST /whatsapp-webhook             Incoming messages → conversation engine → replies
//   POST /whatsapp-webhook/dispatch    Database Webhooks on notifications INSERT and alert_deliveries INSERT → sends
//                                      booking/driver/incident messages to tourists & drivers
//
// Uses the SAME conversation engine as the in-browser simulator, and the SAME SQL tools as the
// MCP server (public.assistant_tool → private.tool_*).
// Deploy:  supabase functions deploy whatsapp-webhook --no-verify-jwt
// Secrets: see README → "WhatsApp integration".
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from '../_shared/conversation.js'

const env = (k) => Deno.env.get(k) ?? ''
const GRAPH = `https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`
const APP_URL = env('PUBLIC_APP_URL').replace(/\/$/, '')
const RPC_TIMEOUT_MS = 8000
const WINDOW_MS = 24 * 3600e3 // WhatsApp customer-service window
// Service role: bypasses RLS. Never expose this key to the browser.
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

// ---------------------------------------------------------------- security
async function validSignature(raw, header) {
  if (!header?.startsWith('sha256=') || !env('WHATSAPP_APP_SECRET')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('WHATSAPP_APP_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  const given = header.slice(7)
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i) // constant time
  return diff === 0
}

// ---------------------------------------------------------------- engine API (service role)
const rpc = async (fn, args) => {
  const { data, error } = await db.rpc(fn, args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  if (error) throw new Error(error.message?.replace(/^(invalid|not_found|disabled):/, '') ?? 'database error')
  return data
}
// Public, non-personal lists only. ponytail: 60 s per-isolate TTL, so admin edits show within a minute; switch to explicit invalidation if that is too slow.
const cache = new Map()
const cached = async (key, fn) => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  return value
}
const STATUS = { pending: 'Pending', awaiting_provider: 'Awaiting provider confirmation', confirmed: 'Confirmed', driver_assigned: 'Driver assigned',
  driver_on_way: 'Driver on the way', driver_arrived: 'Driver arrived', in_progress: 'Ride in progress', completed: 'Completed', cancelled: 'Cancelled' }
const rand = (n) => `R${Math.round(Number(n))}`
const apiFor = (waId) => ({
  hotels: () => cached('hotels', async () => (await db.from('hotels').select('slug, name, area, phone').eq('status', 'active').order('name')).data ?? []),
  pickupPoints: () => cached('pickup_points', async () => (await db.from('pickup_points').select('*').order('kind').order('name')).data ?? []),
  async options(slug) {
    const { data } = await db.from('hotel_transport_partners').select('*, hotels!inner(slug), transport_providers!inner(name, status)')
      .eq('hotels.slug', slug).eq('available', true).eq('transport_providers.status', 'active')
    return (data ?? []).map((o) => ({ ...o, provider_name: o.transport_providers.name }))
  },
  createBooking: (p) => rpc('create_booking', { p }),
  getTrip: (t) => rpc('get_trip', { p_token: t }),
  recordVerification: (t, o) => rpc('record_verification', { p_token: t, p_outcome: o }),
  checkCode: (t, c) => rpc('check_spoken_code', { p_token: t, p_code: c }),
  reportIncident: (p) => rpc('report_incident', { p }),
  checkAccommodation: (p) => rpc('check_accommodation', { p }),
  checkProvider: (p) => rpc('check_transport_provider', { p }),
  getIncident: (t) => rpc('get_incident', { p_token: t }),
  guidance: (stage) => rpc('safety_guidance', { p_stage: stage }),
  requestFeedback: (p) => rpc('request_feedback', { p }),
  submitFeedback: (p) => rpc('submit_feedback', { p }),
  tool: (name, args) => rpc('assistant_tool', { p_tool: name, p_args: args, p_client: waId }),
  resolvePlace: (q) => rpc('resolve_place', { p_query: q }),
  categoryInfo: (c) => cached(`cat:${c}`, () => rpc('incident_category_info', { p_category: c })),
  followup: (t, kind, msg) => rpc('incident_followup', { p_token: t, p_kind: kind, p_message: msg }),
  tripLink: (t) => `${APP_URL}/trip/${t}`,
  incidentLink: (t) => `${APP_URL}/incident/${t}`,
  statusLabel: (s) => STATUS[s] ?? s,
  fmtTime: (d) => new Date(d).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  priceText: (b) => (b.price_type === 'agreed' ? `${rand(b.price_amount)} agreed` : b.price_type === 'estimate' ? `${rand(b.price_min)}–${rand(b.price_max)} estimate` : 'to be confirmed'),
})

// ---------------------------------------------------------------- sending
function toWhatsApp(to, r) {
  if (r.type === 'buttons') {
    return { messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'button', body: { text: r.text.slice(0, 1024) },
      action: { buttons: r.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) } } }
  }
  if (r.type === 'list') {
    return { messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type: 'list', body: { text: r.text.slice(0, 1024) },
      action: { button: r.button.slice(0, 20), sections: [{ title: 'Options', rows: r.rows }] } } }
  }
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: r.text.slice(0, 4096), preview_url: true } }
}
async function post(payload) {
  if (!env('WHATSAPP_ACCESS_TOKEN') || !env('WHATSAPP_PHONE_NUMBER_ID')) return 'not_configured'
  try {
    const res = await fetch(GRAPH, { method: 'POST', headers: { Authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) })
    if (!res.ok) console.error(JSON.stringify({ evt: 'send_failed', status: res.status, body: (await res.text()).slice(0, 300) }))
    return res.ok ? 'sent' : 'failed'
  } catch (e) {
    console.error(JSON.stringify({ evt: 'send_failed', error: String(e) }))
    return 'failed'
  }
}
const send = (to, reply) => post(toWhatsApp(to, reply))

// ---------------------------------------------------------------- inbound
async function onMessage(msg, contact) {
  const t0 = Date.now()
  const waId = msg.from
  // Race-safe de-duplication of Meta's retries: only the first insert of a message id proceeds.
  const { error: dup } = await db.from('whatsapp_inbound').insert({ message_id: msg.id })
  if (dup) { console.log(JSON.stringify({ evt: 'duplicate', code: dup.code })); return }

  const { data: row } = await db.from('whatsapp_sessions').select('*').eq('wa_id', waId).maybeSingle()
  const session = row ? { state: row.state, ctx: row.context } : null
  const ctx = { ...(session?.ctx ?? {}), phone: `+${waId}`, profileName: session?.ctx?.name ? undefined : contact?.profile?.name }

  // Simple flood protection: 30 messages per minute per number.
  const now = Date.now()
  const window = (ctx.rate ?? []).filter((t) => now - t < 60_000)
  if (window.length >= 30) return
  ctx.rate = [...window, now]

  let input = {}
  if (msg.type === 'text') input = { text: msg.text.body }
  else if (msg.type === 'interactive') input = { id: msg.interactive.button_reply?.id ?? msg.interactive.list_reply?.id }
  else if (msg.type === 'location') input = { location: { lat: msg.location.latitude, lng: msg.location.longitude, name: msg.location.name } }
  else input = { text: '' }

  // "START hotel-001" comes from a hotel's QR / email deep link.
  const start = input.text?.match(/^START\s+([a-z0-9-]{3,40})$/i)
  if (start) {
    const { data: h } = await db.from('hotels').select('slug, name, phone').eq('slug', start[1].toLowerCase()).eq('status', 'active').maybeSingle()
    if (h) Object.assign(ctx, { hotelSlug: h.slug, hotelName: h.name, hotelPhone: h.phone, source: 'qr_hotel' })
    input = { text: 'hi' }
  }

  const result = await handle(session ? { ...session, ctx } : { state: 'WELCOME', ctx }, input, apiFor(waId))
  const engineMs = Date.now() - t0
  let failed = 0
  for (const r of result.replies) if ((await send(waId, r)) !== 'sent') failed++
  await db.from('whatsapp_sessions').upsert({ wa_id: waId, state: result.session.state, context: result.session.ctx, last_message_id: msg.id, updated_at: new Date().toISOString() })
  // Metrics only: no phone numbers or message text in logs.
  console.log(JSON.stringify({ evt: 'message', type: msg.type, state: result.session.state, engine_ms: engineMs, total_ms: Date.now() - t0, replies: result.replies.length, send_failures: failed }))
}

// ---------------------------------------------------------------- outbound dispatch (Database Webhook)
// Free-form text is only allowed inside the 24-hour customer-service window (since the visitor's
// last message). Outside it, WhatsApp requires a pre-approved TEMPLATE; if none is configured the
// row is marked 'not_configured' so nobody is told a message was delivered.
// Expected update template (1 variable): "SafeArrival update: {{1}}"
async function dispatch(record) {
  if (record.channel !== 'whatsapp' || record.delivery_status !== 'simulated') return
  let to = null
  if (record.recipient_type === 'tourist') {
    if (record.booking_id) to = (await db.from('bookings').select('tourists(whatsapp)').eq('id', record.booking_id).maybeSingle()).data?.tourists?.whatsapp
    if (!to && record.incident_id) to = (await db.from('incidents').select('contact_whatsapp').eq('id', record.incident_id).maybeSingle()).data?.contact_whatsapp
  } else if (record.recipient_type === 'driver') {
    to = (await db.from('drivers').select('phone').eq('id', record.driver_id).maybeSingle()).data?.phone
  }
  if (!to) return
  const waId = to.replace(/\D/g, '')
  const { data: s } = await db.from('whatsapp_sessions').select('updated_at').eq('wa_id', waId).maybeSingle()
  let status
  if (s && Date.now() - new Date(s.updated_at) < WINDOW_MS) status = await send(waId, { type: 'text', text: record.body })
  else if (!env('WHATSAPP_UPDATE_TEMPLATE')) status = 'not_configured'
  else {
    status = await post({ messaging_product: 'whatsapp', to: waId, type: 'template', template: {
      name: env('WHATSAPP_UPDATE_TEMPLATE'), language: { code: env('WHATSAPP_UPDATE_TEMPLATE_LANG') || 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: record.body.replace(/\s*\n+\s*/g, ' · ').slice(0, 900) }] }] } })
  }
  await db.from('notifications').update({ delivery_status: status }).eq('id', record.id)
}

// Safety alerts (Database Webhook on alert_deliveries INSERT). Alerts are business-initiated, so
// WhatsApp only allows a pre-approved TEMPLATE. Expected template body (3 variables), e.g.:
//   "{{1}}: {{2}} Manage or stop these alerts: {{3}}"
// Template variables may not contain newlines, hence the flattening.
async function dispatchAlert(record) {
  if (record.channel !== 'whatsapp' || record.delivery_status !== 'queued') return
  const { data: sub } = await db.from('alert_subscriptions').select('whatsapp, manage_token, status').eq('id', record.subscription_id).maybeSingle()
  let status = 'failed'
  if (!env('WHATSAPP_ALERT_TEMPLATE')) status = 'not_configured'
  else if (sub?.whatsapp && sub.status === 'active') {
    const flat = (s, n) => s.replace(/\s*\n+\s*/g, ' · ').replace(/ {4,}/g, ' ').slice(0, n)
    status = await post({ messaging_product: 'whatsapp', to: sub.whatsapp.replace(/\D/g, ''), type: 'template', template: {
      name: env('WHATSAPP_ALERT_TEMPLATE'), language: { code: env('WHATSAPP_ALERT_TEMPLATE_LANG') || 'en' },
      components: [{ type: 'body', parameters: [flat(record.title, 60), flat(record.body, 900), `${APP_URL}/alerts/${sub.manage_token}`].map((text) => ({ type: 'text', text })) }],
    } })
  }
  await db.from('alert_deliveries').update({ delivery_status: status, updated_at: new Date().toISOString() }).eq('id', record.id)
}

// Finish work after the HTTP response so Meta gets its 200 immediately.
const background = (p) => (globalThis.EdgeRuntime?.waitUntil ? globalThis.EdgeRuntime.waitUntil(p) : p)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('Forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  if (url.pathname.endsWith('/dispatch')) {
    if (req.headers.get('authorization') !== `Bearer ${env('DISPATCH_SECRET')}` || !env('DISPATCH_SECRET')) return new Response('Unauthorized', { status: 401 })
    const { table, record } = await req.json()
    await (table === 'alert_deliveries' ? dispatchAlert(record) : dispatch(record))
    return new Response('ok')
  }

  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('Invalid signature', { status: 401 })
  const body = JSON.parse(raw)
  const work = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {}
      for (const msg of v.messages ?? []) work.push(onMessage(msg, v.contacts?.[0]).catch((e) => console.error(JSON.stringify({ evt: 'message_failed', error: String(e) }))))
    }
  }
  background(Promise.all(work))
  return new Response('ok') // always 200 quickly so Meta doesn't retry
})
