import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BadgeCheck, CalendarClock, Loader2, Luggage, MapPin, Users } from 'lucide-react'
import { rpc } from '../../services/api'
import { simulatorApi } from '../../services/whatsapp/simulator'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { Badge } from '../../components/common/StatusBadges'
import { Button, Field, Panel, inputCls } from '../../components/common/ui'
import { DEMO_TOURIST } from '../../config/demoAccounts'
import { PROVIDER_TYPE, priceInfo } from '../../lib/labels'
import { rememberTrip } from '../../lib/myTrips'

const sastNow = () => new Date(Date.now() + 2 * 3600e3)

/** One transport option, with transparent price type, capacity and verification status. */
export function OptionCard({ o, selected, onSelect, fits = true }) {
  const p = priceInfo(o)
  return (
    <label className={`block cursor-pointer rounded-2xl border bg-white p-4 ${!fits ? 'opacity-50' : ''} ${selected ? 'border-teal ring-2 ring-teal/40' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="flex items-start gap-3">
        <input type="radio" name="option" className="mt-1 size-4 accent-[var(--color-teal)]" checked={selected} disabled={!fits} onChange={onSelect} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{o.provider_name}</p>
            <p className="text-lg font-bold tabular-nums">{p.amount}</p>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={p.tone}>{p.label}</Badge>
            <Badge tone="navy">{PROVIDER_TYPE[o.provider.provider_type]}</Badge>
            <Badge tone="green" icon={BadgeCheck}>Verified partner</Badge>
            {o.provider.integration === 'uber_central' && <Badge tone="amber">Simulated integration</Badge>}
          </div>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            <span>{o.vehicle_class}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3.5" aria-hidden />up to {o.passenger_capacity}</span>
            <span className="inline-flex items-center gap-1"><Luggage className="size-3.5" aria-hidden />up to {o.luggage_capacity} bags</span>
            <span className="text-safe-ink">{fits ? 'Available' : 'Too small for your group'}</span>
          </p>
          <p className="mt-1 text-xs text-muted">Payment: {o.payment_arrangement}</p>
        </div>
      </div>
    </label>
  )
}

/** Form-based booking (the same RPC as the WhatsApp flow). */
export default function BookPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [f, setF] = useState({
    ...DEMO_TOURIST, hotel_slug: params.get('hotel') ?? DEMO_TOURIST.hotel_slug, pickup_point_id: 'cpt-intl',
    date: sastNow().toISOString().slice(0, 10), time: '', flight_number: '', passengers: 2, luggage: 2, partner_id: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'hotel_slug' ? { partner_id: '' } : {}) }))

  const { data: dir } = useLive(async () => ({ hotels: await simulatorApi.hotels(), points: await simulatorApi.pickupPoints() }), [])
  const { data: options } = useLive(() => simulatorApi.options(f.hotel_slug), [f.hotel_slug])
  const hotel = dir?.hotels.find((h) => h.slug === f.hotel_slug)
  const chosen = useMemo(() => options?.find((o) => o.id === f.partner_id), [options, f.partner_id])

  const submit = async (e) => {
    e.preventDefault()
    if (!chosen) return toast.error('Please choose a transport option')
    setBusy(true)
    try {
      const r = await rpc('create_booking', { p: { full_name: f.full_name, whatsapp: f.whatsapp, hotel_slug: f.hotel_slug, partner_id: f.partner_id,
        pickup_point_id: f.pickup_point_id, pickup_at: `${f.date}T${f.time}:00+02:00`, flight_number: f.flight_number,
        passengers: +f.passengers, luggage: +f.luggage, source: params.get('hotel') ? 'qr_hotel' : 'web' } })
      rememberTrip({ token: r.access_token, reference: r.reference, created_at: new Date().toISOString() })
      toast.success(`Booking ${r.reference} requested`)
      navigate(`/trip/${r.access_token}`)
    } catch (err) { toast.error(err.message); setBusy(false) }
  }

  return (
    <PublicPage narrow>
      <h1 className="text-2xl font-semibold tracking-tight">Arrange trusted transport</h1>
      <p className="mt-1 text-sm text-muted">Prefer chatting? Use the <a href={`/assistant${params.get('hotel') ? `?hotel=${params.get('hotel')}` : ''}`} className="font-medium text-teal-ink underline">WhatsApp assistant</a>. It creates the same booking.</p>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <Panel title={<span className="flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />Trip</span>} bodyClass="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Your hotel or accommodation">
            <select className={inputCls} value={f.hotel_slug} onChange={set('hotel_slug')} required>
              {dir?.hotels.map((h) => <option key={h.slug} value={h.slug}>{h.name} · {h.area}</option>)}
            </select>
          </Field>
          <Field label="Pickup location">
            <select className={inputCls} value={f.pickup_point_id} onChange={set('pickup_point_id')}>
              {dir?.points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Destination" hint="Your hotel’s address, filled in automatically."><input className={inputCls} readOnly value={hotel ? `${hotel.name}, ${hotel.address}` : ''} /></Field>
          <Field label="Flight number (optional)"><input className={inputCls} value={f.flight_number} onChange={set('flight_number')} placeholder="e.g. BA59" maxLength={8} /></Field>
        </Panel>

        <Panel title={<span className="flex items-center gap-1.5"><CalendarClock className="size-4" aria-hidden />Arrival &amp; group</span>} bodyClass="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Arrival date"><input type="date" className={inputCls} value={f.date} min={sastNow().toISOString().slice(0, 10)} onChange={set('date')} required /></Field>
          <Field label="Arrival time (Cape Town time)"><input type="time" className={inputCls} value={f.time} onChange={set('time')} required /></Field>
          <Field label="Passengers"><select className={inputCls} value={f.passengers} onChange={set('passengers')}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Large bags"><select className={inputCls} value={f.luggage} onChange={set('luggage')}>{[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n}>{n}</option>)}</select></Field>
        </Panel>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Transport options from {hotel?.name ?? 'your hotel'}</legend>
          {options?.map((o) => (
            <OptionCard key={o.id} o={o} selected={f.partner_id === o.id} onSelect={() => setF((x) => ({ ...x, partner_id: o.id }))}
              fits={o.passenger_capacity >= f.passengers && o.luggage_capacity >= f.luggage} />
          ))}
          {options?.length === 0 && <p className="text-sm text-muted">This hotel has no transport options yet.</p>}
        </fieldset>

        <Panel title="Your details" bodyClass="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Full name" hint="Your driver sees only your first name."><input className={inputCls} value={f.full_name} onChange={set('full_name')} required minLength={2} maxLength={60} autoComplete="name" /></Field>
          <Field label="WhatsApp number" hint="With country code. Updates and your code arrive here."><input className={inputCls} value={f.whatsapp} onChange={set('whatsapp')} required inputMode="tel" autoComplete="tel" /></Field>
        </Panel>

        {chosen && (
          <div className="rounded-2xl border border-teal/30 bg-teal/5 p-4 text-sm">
            <p className="font-semibold">Before you confirm</p>
            <p className="mt-1">{priceInfo(chosen).label}: <strong>{priceInfo(chosen).amount}</strong>. {priceInfo(chosen).note}</p>
            <p className="mt-1">Payment: {chosen.payment_arrangement}</p>
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !chosen}>{busy && <Loader2 className="size-5 animate-spin" aria-hidden />}Request booking</Button>
        <p className="text-center text-xs text-muted">We collect only what’s needed for your pickup. No passport or card details.</p>
      </form>
    </PublicPage>
  )
}
