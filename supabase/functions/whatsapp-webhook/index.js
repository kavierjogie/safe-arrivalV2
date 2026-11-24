// Supabase Edge Function: WhatsApp Business Cloud API (Meta) integration.
//
//   GET  /whatsapp-webhook             Meta webhook verification (hub.challenge)
//   POST /whatsapp-webhook             Incoming messages → conversation engine → replies
//   POST /whatsapp-webhook/dispatch    Database Webhook on notifications INSERT → sends
//                                      booking/driver/incident messages to tourists & drivers
//
// Uses the SAME conversation engine as the in-browser simulator.
// Deploy:  supabase functions deploy whatsapp-webhook --no-verify-jwt
// Secrets: see README → "WhatsApp integration".
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from '../_shared/conversation.js'

const env = (k) => Deno.env.get(k) ?? ''
const GRAPH = `https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`
const APP_URL = env('PUBLIC_APP_URL').replace(/\/$/, '')
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
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}
const STATUS = { pending: 'Pending', awaiting_provider: 'Awaiting provider confirmation', confirmed: 'Confirmed', driver_assigned: 'Driver assigned',
  driver_on_way: 'Driver on the way', driver_arrived: 'Driver arrived', in_progress: 'Ride in progress', completed: 'Completed', cancelled: 'Cancelled' }
const rand = (n) => `R${Math.round(Number(n))}`
const api = {
  hotels: async () => (await db.from('hotels').select('slug, name, area, phone').eq('status', 'active').order('name')).data ?? [],
  pickupPoints: async () => (await db.from('pickup_points').select('*').order('kind').order('name')).data ?? [],
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
  tripLink: (t) => `${APP_URL}/trip/${t}`,
  incidentLink: (t) => `${APP_URL}/incident/${t}`,
  statusLabel: (s) => STATUS[s] ?? s,
  fmtTime: (d) => new Date(d).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  priceText: (b) => (b.price_type === 'agreed' ? `${rand(b.price_amount)} agreed` : b.price_type === 'estimate' ? `${rand(b.price_min)}–${rand(b.price_max)} estimate` : 'to be confirmed'),
}

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
async function send(to, reply) {
  const res = await fetch(GRAPH, { method: 'POST', headers: { Authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toWhatsApp(to, reply)) })
  if (!res.ok) console.error('WhatsApp send failed', res.status, await res.text())
  return res.ok
}

// ---------------------------------------------------------------- inbound
async function onMessage(msg, contact) {
  const waId = msg.from
  const { data: row } = await db.from('whatsapp_sessions').select('*').eq('wa_id', waId).maybeSingle()
  if (row?.last_message_id === msg.id) return // Meta retries deliveries: ignore duplicates
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
  else input = { text: '' }

  // "START hotel-001" comes from a hotel's QR / email deep link.
  const start = input.text?.match(/^START\s+([a-z0-9-]{3,40})$/i)
  if (start) {
    const { data: h } = await db.from('hotels').select('slug, name, phone').eq('slug', start[1].toLowerCase()).eq('status', 'active').maybeSingle()
    if (h) Object.assign(ctx, { hotelSlug: h.slug, hotelName: h.name, hotelPhone: h.phone, source: 'qr_hotel' })
    input = { text: 'hi' }
  }

  const result = await handle(session ? { ...session, ctx } : { state: 'WELCOME', ctx }, input, api)
  for (const r of result.replies) await send(waId, r)
  await db.from('whatsapp_sessions').upsert({ wa_id: waId, state: result.session.state, context: result.session.ctx, last_message_id: msg.id, updated_at: new Date().toISOString() })
}

// ---------------------------------------------------------------- outbound dispatch (Database Webhook)
// Business-initiated messages outside WhatsApp's 24-hour window must use
// pre-approved templates; this sends free-form text inside the window.
async function dispatch(record) {
  if (record.channel !== 'whatsapp' || record.delivery_status !== 'simulated') return
  let to = null
  if (record.recipient_type === 'tourist') {
    const { data } = await db.from('bookings').select('tourists(whatsapp)').eq('id', record.booking_id).maybeSingle()
    to = data?.tourists?.whatsapp
  } else if (record.recipient_type === 'driver') {
    to = (await db.from('drivers').select('phone').eq('id', record.driver_id).maybeSingle()).data?.phone
  }
  if (!to) return
  const ok = await send(to.replace(/\D/g, ''), { type: 'text', text: record.body })
  await db.from('notifications').update({ delivery_status: ok ? 'sent' : 'failed' }).eq('id', record.id)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('Forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  if (url.pathname.endsWith('/dispatch')) {
    if (req.headers.get('authorization') !== `Bearer ${env('DISPATCH_SECRET')}` || !env('DISPATCH_SECRET')) return new Response('Unauthorized', { status: 401 })
    const { record } = await req.json()
    await dispatch(record)
    return new Response('ok')
  }

  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('Invalid signature', { status: 401 })
  const body = JSON.parse(raw)
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {}
      for (const msg of v.messages ?? []) {
        try { await onMessage(msg, v.contacts?.[0]) } catch (e) { console.error('message handling failed', e) }
      }
    }
  }
  return new Response('ok') // always 200 quickly so Meta doesn't retry
})
