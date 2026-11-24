import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BadgeCheck, ExternalLink, MessageCircle, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react'
import { handle } from '../../../supabase/functions/_shared/conversation.js'
import { simulatorApi } from '../../services/whatsapp/simulator'
import { rpc, select } from '../../services/api'
import { useApp, useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import ChatWindow from '../../components/chat/ChatWindow'
import { BookingStatusBadge } from '../../components/common/StatusBadges'
import { Button, Field, Panel, inputCls } from '../../components/common/ui'
import { Checklist, SomethingWrongButton } from '../../components/tourist/TripBits'
import { DEMO_TOURIST } from '../../config/demoAccounts'
import { PICKUP_TIPS, fmt } from '../../lib/labels'
import { CHAT_KEY, rememberTrip } from '../../lib/myTrips'

const load = () => { try { return JSON.parse(localStorage.getItem(CHAT_KEY)) } catch { return null } }
const entry = (from, reply) => ({ id: crypto.randomUUID(), from, at: new Date().toISOString(), reply })

/** Drives the shared conversation engine and stores the chat on this device. */
function useConversation() {
  const [chat, setChat] = useState(() => load())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    try {
      if (chat) localStorage.setItem(CHAT_KEY, JSON.stringify(chat))
      else localStorage.removeItem(CHAT_KEY)
    } catch { /* storage blocked: chat still works for this visit */ }
  }, [chat])

  const send = useCallback(async (input, label) => {
    if (!chat || busy) return
    const userEntry = entry('user', { type: 'text', text: label ?? input.text })
    setChat((c) => ({ ...c, log: [...c.log, userEntry] }))
    setBusy(true)
    const [{ session, replies }] = await Promise.all([handle(chat.session, input, simulatorApi), new Promise((r) => setTimeout(r, 450))])
    if (session.ctx.bookingToken && session.ctx.bookingToken !== chat.session.ctx.bookingToken) {
      rememberTrip({ token: session.ctx.bookingToken, reference: session.ctx.bookingRef, created_at: new Date().toISOString() })
    }
    setChat((c) => ({ ...c, session, log: [...c.log, ...replies.map((r) => entry('bot', r))] }))
    setBusy(false)
  }, [chat, busy])

  const start = useCallback(async ({ name, phone, hotel }) => {
    const ctx = { profileName: name, phone: phone.replace(/[\s()-]/g, ''), source: hotel ? 'qr_hotel' : 'whatsapp' }
    if (hotel) Object.assign(ctx, { hotelSlug: hotel.slug, hotelName: hotel.name, hotelPhone: hotel.phone })
    const first = { session: { state: 'WELCOME', ctx }, log: [] }
    setChat(first)
    setBusy(true)
    const { session, replies } = await handle(first.session, { text: 'Hi' }, simulatorApi)
    setChat({ session, log: [entry('user', { type: 'text', text: 'Hi' }), ...replies.map((r) => entry('bot', r))] })
    setBusy(false)
  }, [])

  const reset = useCallback(() => setChat(null), [])
  return { chat, busy, send, start, reset }
}

function StartScreen({ hotel, ready, onStart }) {
  const [name, setName] = useState(DEMO_TOURIST.full_name)
  const [phone, setPhone] = useState(DEMO_TOURIST.whatsapp)
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-deep to-navy p-6 text-white">
      <div className="mt-6 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-teal"><ShieldCheck className="size-9" aria-hidden /></span>
        <p className="mt-3 flex items-center justify-center gap-1 text-lg font-semibold">Safe Arrival CPT <BadgeCheck className="size-5 text-teal" aria-label="Verified" /></p>
        <p className="text-sm text-white/70">Official WhatsApp Business account</p>
        {hotel && <p className="mx-auto mt-3 w-fit rounded-full bg-white/10 px-3 py-1 text-xs">Opened from <strong>{hotel.name}</strong></p>}
      </div>
      <form className="mt-auto space-y-3 rounded-2xl bg-white p-4 text-navy" onSubmit={(e) => { e.preventDefault(); onStart({ name, phone, hotel }) }}>
        <p className="text-xs text-muted">On real WhatsApp your name and number come from your WhatsApp profile. For this simulation, confirm them:</p>
        <Field label="WhatsApp profile name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} /></Field>
        <Field label="WhatsApp number"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} required pattern="\+[0-9 ]{8,18}" inputMode="tel" /></Field>
        <Button type="submit" className="w-full" size="lg" disabled={!ready}><MessageCircle className="size-5" aria-hidden />{ready ? 'Send “Hi”' : 'Connecting…'}</Button>
      </form>
    </div>
  )
}

export default function AssistantPage() {
  const [params] = useSearchParams()
  const { dbReady } = useApp()
  const { chat, busy, send, start, reset } = useConversation()
  const slug = params.get('hotel')
  const { data: hotel } = useLive(async () => slug ? (await select('hotels', null)).find((h) => h.slug === slug) ?? null : null, [slug])
  const token = chat?.session.ctx.bookingToken
  const { data: trip, error: tripError } = useLive(() => rpc('get_trip', { p_token: token }), [token], { poll: 4000, enabled: Boolean(token) })
  // The booking behind this chat no longer exists (e.g. the demo was reset in another tab): start over.
  useEffect(() => { if (tripError?.message?.includes('not found')) reset() }, [tripError, reset])

  // Messages the backend "sent" to the tourist's WhatsApp appear in the chat as they would on a phone.
  const log = useMemo(() => {
    if (!chat) return []
    const pushed = (trip?.messages ?? []).map((m) => ({ id: `push-${m.id}`, from: 'bot', push: true, at: m.created_at, reply: { type: 'text', text: m.body } }))
    return [...chat.log, ...pushed].sort((a, b) => a.at.localeCompare(b.at))
  }, [chat, trip])

  return (
    <PublicPage>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/15 px-2.5 py-1 text-xs font-semibold text-[#0d6b37]"><Smartphone className="size-3.5" aria-hidden />WhatsApp experience · simulated</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tourist transport assistant</h1>
          <p className="max-w-2xl text-sm text-muted">The same conversation engine runs behind the production WhatsApp Business webhook. Here it's simulated in the browser, so you need no WhatsApp number.</p>
        </div>
        {chat && <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="size-4" aria-hidden />Restart conversation</Button>}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[400px_1fr]">
        <div className="mx-auto w-full max-w-[400px] lg:sticky lg:top-4">
          <div className="rounded-[2.4rem] bg-navy p-2.5 shadow-2xl">
            <div className="relative h-[min(760px,calc(100dvh-150px))] min-h-[560px] overflow-hidden rounded-[2rem]">
              {!dbReady ? <div className="grid h-full place-items-center bg-chat text-sm text-muted">Starting…</div>
                : chat ? <ChatWindow log={log} state={chat.session.state} busy={busy} onSend={(t) => send({ text: t })} onTap={(b) => send({ id: b.id }, b.title)} />
                  : <StartScreen hotel={hotel} ready={!slug || hotel !== undefined} onStart={start} />}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {trip ? (
            <Panel title="Your booking" action={<span className="font-mono text-xs text-muted">{trip.booking.reference}</span>} bodyClass="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2"><BookingStatusBadge status={trip.booking.status} /><span className="text-sm text-muted">{fmt(trip.booking.pickup_at)}</span></div>
              {trip.driver && <p className="text-sm"><strong>{trip.driver.full_name}</strong> · {trip.driver.colour} {trip.driver.make} {trip.driver.model} · <span className="font-mono">{trip.driver.registration}</span></p>}
              <Button as={Link} to={`/trip/${token}`} target="_blank" variant="dark" className="w-full"><ExternalLink className="size-4" aria-hidden />Open booking page: driver, code &amp; map</Button>
              <SomethingWrongButton to={`/report?trip=${token}`} />
            </Panel>
          ) : (
            <Panel title="How this works" bodyClass="p-4 text-sm text-slate-700">
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>Arrange transport: choose your pickup point, arrival time and one of your hotel’s approved options. You see the price before you confirm.</li>
                <li>Your hotel confirms and assigns an approved driver.</li>
                <li>You get the driver’s name, photo, vehicle, registration and a one-time code.</li>
                <li>At pickup, the driver says the code first. If it doesn’t match, don’t get in. Tap <em>Something’s wrong</em>.</li>
              </ol>
            </Panel>
          )}
          <Panel title="Before you get in" bodyClass="p-4"><Checklist items={PICKUP_TIPS} /></Panel>
        </div>
      </div>
    </PublicPage>
  )
}
