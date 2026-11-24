import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, Building2, Car, CheckCircle2, ClipboardCheck, Keyboard, MapPin, MessageCircle, Phone, ShieldCheck, Users, XCircle } from 'lucide-react'
import { rpc } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { BookingStatusBadge, IncidentStatusBadge, VerifyBadge } from '../../components/common/StatusBadges'
import { Button, ConfirmDialog, EmptyState, Field, Info, Panel, Spinner, inputCls } from '../../components/common/ui'
import PickupMap from '../../components/maps/PickupMap'
import { Checklist, CodeCard, DriverCard, PriceCard, SomethingWrongButton, StatusStepper, WhatsAppMessages } from '../../components/tourist/TripBits'
import { INCIDENT_CATEGORY, OUTCOME_TO_CATEGORY, PICKUP_TIPS, TRANSPORT_TYPE, fmt } from '../../lib/labels'
import { rememberTrip } from '../../lib/myTrips'

const VERIFY_OPTIONS = [
  ['verified', 'Driver verified', 'The driver said my code first and everything matches', CheckCircle2, 'safe'],
  ['code_mismatch', 'Code does not match', 'The driver said a different code, or none', XCircle, 'danger'],
  ['details_mismatch', 'Driver details do not match', 'Different name or the photo doesn’t match', Users, 'danger'],
  ['wrong_vehicle', 'Wrong vehicle', 'Registration, make or colour is different', Car, 'danger'],
  ['cannot_find', 'I cannot find my driver', 'Nobody at the meeting point', MapPin, 'danger'],
]

/** The tourist confirms (or rejects) the driver. Failures go straight to a prefilled report. */
function VerifyPanel({ token }) {
  const navigate = useNavigate()
  const [spoken, setSpoken] = useState('')
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)

  const record = async (outcome) => {
    setBusy(true)
    try {
      await rpc('record_verification', { p_token: token, p_outcome: outcome })
      if (outcome === 'verified') toast.success('Driver verified. Your ride has started.')
      else navigate(`/report?trip=${token}&category=${OUTCOME_TO_CATEGORY[outcome]}`)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const checkSpoken = async (e) => {
    e.preventDefault()
    try { setCheck((await rpc('check_spoken_code', { p_token: token, p_code: spoken })).match) } catch (err) { toast.error(err.message) }
  }

  return (
    <Panel title="Verify your driver" bodyClass="space-y-4 p-4" className="ring-2 ring-teal/40">
      <ol className="space-y-1 text-sm">
        <li><strong>1.</strong> Check the registration plate and vehicle against your driver card.</li>
        <li><strong>2.</strong> Ask: <em>“What is my verification code?”</em> <strong>Don’t say it first.</strong></li>
        <li><strong>3.</strong> Compare their answer with your code, then choose below.</li>
      </ol>
      <form onSubmit={checkSpoken} className="rounded-xl bg-slate-50 p-3">
        <Field label={<span className="flex items-center gap-1.5"><Keyboard className="size-4" aria-hidden />Optional: type what the driver said and we’ll check it</span>}>
          <div className="flex gap-2">
            <input className={inputCls} value={spoken} onChange={(e) => { setSpoken(e.target.value); setCheck(null) }} placeholder="e.g. blue table 47" autoComplete="off" maxLength={40} />
            <Button type="submit" variant="dark" disabled={spoken.trim().length < 3}>Check</Button>
          </div>
        </Field>
        {check === true && <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-safe-ink" role="status"><CheckCircle2 className="size-4" aria-hidden />That matches your code.</p>}
        {check === false && <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-alert-ink" role="alert"><XCircle className="size-4" aria-hidden />That does NOT match. Do not get into the vehicle.</p>}
      </form>
      <div className="grid gap-2 sm:grid-cols-2">
        {VERIFY_OPTIONS.map(([id, label, hint, Icon, tone]) => (
          <button key={id} disabled={busy} onClick={() => record(id)}
            className={`flex items-start gap-3 rounded-xl border p-3 text-left disabled:opacity-50 ${tone === 'safe' ? 'border-safe/40 bg-safe/10 hover:bg-safe/15 sm:col-span-2' : 'border-alert/25 bg-white hover:bg-alert/5'}`}>
            <Icon className={`mt-0.5 size-5 shrink-0 ${tone === 'safe' ? 'text-safe-ink' : 'text-alert-ink'}`} aria-hidden />
            <span><span className="block font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

export default function TripPage() {
  const { token } = useParams()
  const { data: trip, error, loading } = useLive(() => rpc('get_trip', { p_token: token }), [token], { poll: 4000 })
  const [cancel, setCancel] = useState(false)

  useEffect(() => { if (trip) rememberTrip({ token, reference: trip.booking.reference, created_at: trip.booking.created_at }) }, [trip, token])

  if (loading && !trip) return <PublicPage narrow><Spinner label="Loading your booking…" /></PublicPage>
  if (error || !trip) return <PublicPage narrow><EmptyState icon={AlertTriangle} title="Booking not found">Check the link from your WhatsApp message, or contact your hotel.</EmptyState></PublicPage>

  const b = trip.booking
  const verifying = ['driver_assigned', 'driver_on_way', 'driver_arrived'].includes(b.status)
  const lastAttempt = trip.attempts[0]

  return (
    <PublicPage narrow>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-muted">{b.reference}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Hi {trip.tourist.full_name.split(' ')[0]}, here’s your transport</h1>
          </div>
          <BookingStatusBadge status={b.status} />
        </div>
        <StatusStepper status={b.status} />
        {b.status_note && <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm">{b.status_note}</p>}

        <SomethingWrongButton to={`/report?trip=${token}`} />

        {verifying && b.status === 'driver_arrived' && (
          <p className="flex items-center gap-2 rounded-xl bg-teal/10 px-3 py-2.5 text-sm font-semibold text-teal-ink" role="status"><MapPin className="size-4" aria-hidden />Your driver has arrived at the pickup point.</p>
        )}

        {trip.driver ? (
          <section aria-labelledby="driver-h" className="space-y-3">
            <h2 id="driver-h" className="text-lg font-semibold">Who is collecting you</h2>
            <DriverCard driver={trip.driver} provider={trip.provider} />
            <CodeCard code={trip.code} expiresAt={trip.code_expires_at} status={trip.code_status} />
          </section>
        ) : !['cancelled', 'completed'].includes(b.status) && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm">
            <p className="font-semibold">Driver not assigned yet</p>
            <p className="mt-1 text-slate-600">You’ll get the driver’s name, photo, vehicle and a one-time code by WhatsApp and on this page. <strong>Until then, anyone who says they’re your driver is not.</strong></p>
          </div>
        )}

        {verifying && <VerifyPanel token={token} />}
        {lastAttempt && !verifying && <p className="flex items-center gap-2 text-sm">Last verification: <VerifyBadge outcome={lastAttempt.outcome} /> <span className="text-muted">{fmt(lastAttempt.created_at, 'HH:mm')}</span></p>}

        <PriceCard booking={b} />

        <Panel title="Pickup instructions" bodyClass="space-y-3 p-4">
          <div>
            <p className="font-semibold">{trip.pickup_point.name}</p>
            {trip.pickup_point.terminal_info && <p className="text-sm text-muted">{trip.pickup_point.terminal_info}</p>}
            <p className="mt-1 text-sm">{trip.pickup_point.description}</p>
          </div>
          <PickupMap point={trip.pickup_point} />
          {trip.driver && <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><Car className="size-4 text-muted" aria-hidden />Look for a <strong>{trip.driver.colour} {trip.driver.make} {trip.driver.model}</strong>, registration <strong className="font-mono">{trip.driver.registration}</strong>.</p>}
          <p className="text-xs text-muted">Meeting point descriptions are demo content. Always follow official airport signage.</p>
          <Checklist items={PICKUP_TIPS} />
        </Panel>

        <Panel title="Booking details" bodyClass="p-4">
          <dl className="grid grid-cols-2 gap-4">
            <Info label="Pickup time">{fmt(b.pickup_at)}</Info>
            <Info label="Flight">{b.flight_number}</Info>
            <Info label="Destination" className="col-span-2">{b.destination}</Info>
            <Info label="Transport">{TRANSPORT_TYPE[b.transport_type]}</Info>
            <Info label="Provider">{trip.provider?.name}</Info>
            <Info label="Passengers">{b.passengers}</Info>
            <Info label="Bags">{b.luggage}</Info>
          </dl>
        </Panel>

        <Panel title="Who to contact" bodyClass="space-y-2 p-4 text-sm">
          <p className="flex items-center gap-2"><Building2 className="size-4 text-muted" aria-hidden /><strong>{trip.hotel.name}</strong>
            {trip.hotel.phone && <a className="ml-auto inline-flex items-center gap-1 font-medium text-teal-ink" href={`tel:${trip.hotel.phone.replace(/\s/g, '')}`}><Phone className="size-4" aria-hidden />{trip.hotel.phone}</a>}</p>
          <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted" aria-hidden />Safety problems: use <strong>Something’s wrong</strong> above. Emergencies: <a href="tel:10111" className="font-semibold text-alert-ink">10111</a> or <a href="tel:112" className="font-semibold text-alert-ink">112</a>.</p>
        </Panel>

        {trip.incidents.length > 0 && (
          <Panel title="Your reports" bodyClass="divide-y divide-slate-100">
            {trip.incidents.map((i) => (
              <Link key={i.reference} to={`/incident/${i.access_token}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                <span><span className="font-mono text-sm font-semibold">{i.reference}</span><span className="block text-xs text-muted">{INCIDENT_CATEGORY[i.category]}</span></span>
                <IncidentStatusBadge status={i.status} />
              </Link>
            ))}
          </Panel>
        )}

        <Panel title={<span className="flex items-center gap-1.5"><MessageCircle className="size-4" aria-hidden />WhatsApp messages</span>} bodyClass="p-3">
          <WhatsAppMessages messages={trip.messages} />
        </Panel>

        {!['in_progress', 'completed', 'cancelled'].includes(b.status) && (
          <div className="text-center"><button onClick={() => setCancel(true)} className="text-sm font-medium text-muted underline hover:text-alert-ink">Cancel this booking</button></div>
        )}
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted"><ClipboardCheck className="size-3.5" aria-hidden />Keep this link private. It shows your verification code.</p>
      </div>
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title="Cancel booking?" variant="danger" confirmLabel="Cancel booking"
        message="Your hotel will be notified and your verification code will stop working."
        onConfirm={() => rpc('cancel_my_booking', { p_token: token, p_reason: 'Cancelled by guest' }).then(() => toast.success('Booking cancelled')).catch((e) => toast.error(e.message))} />
    </PublicPage>
  )
}
