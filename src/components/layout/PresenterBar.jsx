import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2, ChevronDown, ChevronUp, IdCard, ListChecks, MessageCircle, MonitorCog, RotateCcw, Zap } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { backend, resetDemo, rpc } from '../../services/api'
import { ConfirmDialog, Modal, Button } from '../common/ui'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../config/demoAccounts'
import { CHAT_KEY, forgetAll, latestTrip } from '../../lib/myTrips'

const [FATIMA, ADMIN, MICHAEL] = ['frontdesk@saltwaterlodge.demo', 'admin@safearrival.demo', 'michael@saltwaterlodge.demo']
const idOf = (email) => DEMO_ACCOUNTS.find((a) => a.email === email).id

const SCRIPT = [
  ['Scenario 1: verified pickup', [
    'Tourist → Arrange transport → International Arrivals → Today → a time → 2 passengers → 2 bags → Saltwater Lodge Transfers (R450 agreed) → Confirm.',
    'Hotel (Fatima) → the request appears live → open it → Confirm booking → assign Michael Daniels + the white Corolla CA 123-456.',
    'Tourist → the driver message arrives with photo, registration and a one-time code. Open the booking page to show the map and code.',
    'Driver (Michael) → “I’m on my way” → “I’ve arrived”. He can’t start the ride himself.',
    'Tourist → Verify my driver → type the code Michael says (or tap “Code matches”) → ride in progress.',
  ]],
  ['Scenario 2: impostor refused', [
    'Repeat steps 1–3 with a new booking (or use the shortcut below).',
    'Tourist → Verify my driver → Other problem → Wrong vehicle. The assistant says “Do not enter the vehicle”.',
    'Describe it (demo suggestion) → No, I am safe → a SAFE-… reference arrives at once.',
    'Hotel → the incident appears with a toast → Acknowledge → the update reaches the tourist’s WhatsApp and tracking page.',
    'Admin → Incidents → investigate, assign a handler, record a SAPS reference if the guest has one. Overview shows the recurring-pattern insight.',
  ]],
]

/** Floating presentation controls: switch roles in this tab, guided script, shortcuts, reset. */
export default function PresenterBar() {
  const { signIn, profile } = useApp()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [confirm, setConfirm] = useState(false)
  const [guide, setGuide] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const view = async (email, to) => {
    try {
      if (email && profile?.email !== email) await signIn(email, DEMO_PASSWORD)
      navigate(to)
    } catch (e) { toast.error(e.message) }
  }

  // Shortcuts act as the hotel/driver. Demo mode runs them as the seeded user;
  // with Supabase they run as whoever is signed in (admin can do all of them).
  const asUser = (email) => (backend === 'local' ? { as: idOf(email) } : {})
  const sarahsBooking = async () => {
    const t = latestTrip()
    if (!t) throw new Error('No tourist booking on this device yet. Create one in the assistant first.')
    return (await rpc('get_trip', { p_token: t.token })).booking
  }
  const shortcut = async (label, fn) => {
    try { await fn(); toast.success(label) } catch (e) { toast.error(e.message) }
  }
  const hotelConfirmAndAssign = () => shortcut('Hotel confirmed and assigned Michael. Code sent to tourist + driver.', async () => {
    const b = await sarahsBooking()
    if (b.status === 'pending' || b.status === 'awaiting_provider') await rpc('confirm_booking', { p_booking: b.id }, asUser(FATIMA))
    await rpc('assign_driver', { p_booking: b.id, p_driver: 'c0000000-0000-4000-8000-000000000001', p_vehicle: 'd0000000-0000-4000-8000-000000000001' }, asUser(FATIMA))
  })
  const driverArrives = () => shortcut('Michael is on the way and has arrived', async () => {
    const b = await sarahsBooking()
    if (b.status === 'driver_assigned') await rpc('update_trip_status', { p_booking: b.id, p_status: 'driver_on_way' }, asUser(MICHAEL))
    await rpc('update_trip_status', { p_booking: b.id, p_status: 'driver_arrived' }, asUser(MICHAEL))
  })

  const reset = async () => {
    try {
      await resetDemo()
      localStorage.removeItem(CHAT_KEY)
      forgetAll()
      toast.success('Demo reset to its starting data')
      setTimeout(() => location.reload(), 400)
    } catch (e) { toast.error(`${e.message}${backend === 'supabase' ? ' (sign in as the admin to reset)' : ''}`) }
  }

  if (pathname === '/login' && !profile) return null
  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)} className="fixed bottom-3 right-3 z-[500] flex items-center gap-1 rounded-full bg-navy px-3 py-2 text-xs font-medium text-white shadow-lg" aria-label="Show presenter controls">
        <ChevronUp className="size-4" aria-hidden />Demo
      </button>
    )
  }
  const btn = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/85 hover:bg-white/10 sm:text-sm'
  const on = (p) => (pathname.startsWith(p) ? ' bg-teal text-white' : '')

  return (
    <>
      <nav aria-label="Demo presenter controls" className="fixed inset-x-2 bottom-2 z-[500] mx-auto flex max-w-fit items-center gap-1 overflow-x-auto rounded-xl bg-navy/95 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur">
        <span className="hidden px-2 text-[10px] font-semibold uppercase tracking-wider text-white/50 md:block">Demo</span>
        <button className={btn + on('/assistant')} onClick={() => view(null, '/assistant?hotel=hotel-001')}><MessageCircle className="size-4" aria-hidden /><span className="hidden sm:inline">Tourist</span></button>
        <button className={btn + on('/hotel')} onClick={() => view(FATIMA, '/hotel')}><Building2 className="size-4" aria-hidden /><span className="hidden sm:inline">Hotel</span></button>
        <button className={btn + on('/driver')} onClick={() => view(MICHAEL, '/driver')}><IdCard className="size-4" aria-hidden /><span className="hidden sm:inline">Driver</span></button>
        <button className={btn + on('/admin')} onClick={() => view(ADMIN, '/admin')}><MonitorCog className="size-4" aria-hidden /><span className="hidden sm:inline">Admin</span></button>
        <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
        <button className={btn} onClick={() => setGuide(true)}><ListChecks className="size-4" aria-hidden /><span className="hidden sm:inline">Guided demo</span></button>
        <button className={`${btn} bg-white/10`} onClick={() => setConfirm(true)}><RotateCcw className="size-4" aria-hidden /><span className="hidden sm:inline">Reset</span></button>
        <button onClick={() => setCollapsed(true)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Hide presenter controls"><ChevronDown className="size-4" /></button>
      </nav>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={reset} title="Reset the demo?" variant="danger" confirmLabel="Reset demo"
        message="Restores the seeded hotels, drivers, bookings and incidents, and clears the tourist chat on this device. Everything created during the demo is removed." />

      <Modal open={guide} onClose={() => setGuide(false)} title="Guided demo (about 4 minutes)" wide>
        <p className="mb-4 rounded-lg bg-teal/10 p-3 text-sm">Tip: open the <strong>Tourist</strong> view in one window and the <strong>Hotel</strong> view in a second window side by side. Changes appear live in both{backend === 'local' ? ', because they share the in-browser database' : ''}.</p>
        {SCRIPT.map(([title, steps]) => (
          <section key={title} className="mb-4">
            <h3 className="mb-2 font-semibold">{title}</h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </section>
        ))}
        <section className="rounded-xl border border-slate-200 p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Zap className="size-4 text-amber" aria-hidden />Shortcuts for the tourist’s latest booking</h3>
          <p className="mb-2 text-xs text-muted">Run the hotel or driver step without switching windows.{backend === 'supabase' ? ' With Supabase these run as the signed-in user; sign in as the admin first.' : ''}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="dark" onClick={hotelConfirmAndAssign}>Hotel: confirm + assign Michael</Button>
            <Button size="sm" variant="outline" onClick={driverArrives}>Driver: on the way → arrived</Button>
          </div>
        </section>
      </Modal>
    </>
  )
}
