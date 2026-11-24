import { useState } from 'react'
import { toast } from 'sonner'
import { Ban, CheckCircle2, KeyRound, MessageCircle, Navigation, MapPin, Play, Flag, Repeat, Tag, UserCheck } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { rpc } from '../../services/api'
import { getAdapter, ADAPTER_NOTE } from '../../services/transport/adapters'
import { Button, Field, Info, Modal, inputCls, textareaCls } from '../common/ui'
import { BookingStatusBadge, IncidentStatusBadge, PartnerStatusBadge, VerifyBadge } from '../common/StatusBadges'
import { DriverPhoto } from '../tourist/TripBits'
import { INCIDENT_CATEGORY, PRICE_TYPE, TRANSPORT_TYPE, fmt, priceInfo, rand } from '../../lib/labels'

function ReasonForm({ label, cta, variant = 'danger', onSubmit, onCancel, min = 3 }) {
  const [v, setV] = useState('')
  return (
    <form className="space-y-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); onSubmit(v.trim()) }}>
      <Field label={label}><textarea className={textareaCls} rows={2} value={v} onChange={(e) => setV(e.target.value)} maxLength={300} required minLength={min} /></Field>
      <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onCancel}>Back</Button><Button type="submit" size="sm" variant={variant}>{cta}</Button></div>
    </form>
  )
}

/** Booking detail + every action the signed-in role may take at the current status. */
export default function BookingDrawer({ ops, bookingId, onClose, onOpenIncident }) {
  const { role } = useApp()
  const b = ops.ix.booking[bookingId]
  const [mode, setMode] = useState(null)
  const [price, setPrice] = useState('')
  const [driverId, setDriverId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [option, setOption] = useState('')
  if (!b) return <Modal open={Boolean(bookingId)} onClose={onClose} title="Booking" drawer><p className="text-sm text-muted">Loading…</p></Modal>

  const tourist = ops.ix.tourist[b.tourist_id]
  const hotel = ops.ix.hotel[b.hotel_id]
  const provider = ops.ix.provider[b.provider_id]
  const point = ops.ix.point[b.pickup_point_id]
  const asg = ops.activeAssignment(b.id)
  const driver = asg && ops.ix.driver[asg.driver_id]
  const vehicle = asg && ops.ix.vehicle[asg.vehicle_id]
  const attempts = ops.verification_attempts.filter((a) => a.booking_id === b.id)
  const incidents = ops.incidents.filter((i) => i.booking_id === b.id)
  const p = priceInfo(b)
  const adapter = getAdapter(provider)

  const isHotel = role === 'hotel_staff' || role === 'admin'
  // Shuttle requests are accepted by the provider; the hotel confirms its own requests.
  const canConfirm = b.status === 'pending' || (b.status === 'awaiting_provider' && role !== 'hotel_staff')
  const canAssign = ['confirmed', 'driver_assigned', 'driver_on_way'].includes(b.status) && role !== 'driver'
  const drivers = ops.drivers.filter((d) => d.provider_id === b.provider_id && d.status === 'approved')
  const vehicles = ops.vehicles.filter((v) => v.provider_id === b.provider_id && v.status === 'active' && v.seats >= b.passengers)
  const options = ops.hotel_transport_partners.filter((o) => o.hotel_id === b.hotel_id && o.available)

  const run = async (fn, msg) => {
    try { await fn(); toast.success(msg); setMode(null) } catch (e) { toast.error(e.message) }
  }
  const confirm = () => run(() => adapter.createBooking(b, { price: price ? Number(price) : null }), `${b.reference} confirmed. Tourist notified on WhatsApp.`)
  const assign = () => run(() => adapter.assignDriver(b, driverId, vehicleId), 'Driver assigned. A new one-time code was sent to the tourist and the driver.')
  const status = (s, note) => run(() => rpc('update_trip_status', { p_booking: b.id, p_status: s, p_note: note ?? null }), 'Status updated')

  return (
    <Modal open onClose={onClose} title={`Booking ${b.reference}`} drawer>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><BookingStatusBadge status={b.status} /><span className="text-sm text-muted">{TRANSPORT_TYPE[b.transport_type]}</span></div>
        {b.status_note && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{b.status_note}</p>}

        <dl className="grid grid-cols-2 gap-4">
          <Info label="Guest">{tourist?.full_name}</Info>
          <Info label="WhatsApp">{tourist && <a className="inline-flex items-center gap-1 text-teal-ink" href={`https://wa.me/${tourist.whatsapp.slice(1)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-3.5" aria-hidden />{tourist.whatsapp}</a>}</Info>
          <Info label="Pickup">{fmt(b.pickup_at)}</Info>
          <Info label="Flight">{b.flight_number}</Info>
          <Info label="From" className="col-span-2">{point?.name}</Info>
          <Info label="To" className="col-span-2">{b.destination}</Info>
          <Info label="Group">{b.passengers} pax · {b.luggage} bags</Info>
          <Info label="Hotel">{hotel?.name}</Info>
          <Info label="Provider" className="col-span-2">{provider?.name} <span className="block text-xs font-normal text-muted">{ADAPTER_NOTE[provider?.integration]}</span></Info>
          <Info label={p.label}>{p.amount}</Info>
          <Info label="Payment">{b.payment_arrangement}</Info>
        </dl>
        {b.external_simulated && <p className="rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber-ink">Simulated Uber Central booking {b.external_ref}. No real Uber trip has been requested.</p>}

        {driver && (
          <section className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{asg.active ? 'Assigned driver' : 'Last driver'}</p>
            <div className="flex items-center gap-3">
              <DriverPhoto path={driver.photo_path} name={driver.full_name} size="size-12" />
              <div className="text-sm"><p className="font-semibold">{driver.full_name}</p><p className="text-muted">{vehicle?.colour} {vehicle?.make} {vehicle?.model} · <span className="font-mono">{vehicle?.registration}</span></p>{driver.phone && <p className="text-muted">{driver.phone}</p>}</div>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><KeyRound className="mt-px size-3.5 shrink-0" aria-hidden />The verification code was sent only to the guest and driver on WhatsApp. It isn’t shown on any dashboard.</p>
          </section>
        )}

        {attempts.length > 0 && (
          <section><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Verification attempts</p>
            <ul className="space-y-1">{attempts.map((a) => <li key={a.id} className="flex items-center justify-between text-sm"><VerifyBadge outcome={a.outcome} /><span className="text-muted">{fmt(a.created_at, 'd MMM HH:mm')}</span></li>)}</ul>
          </section>
        )}
        {incidents.length > 0 && (
          <section><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Incidents</p>
            <ul className="space-y-1">{incidents.map((i) => (
              <li key={i.id}><button className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => onOpenIncident?.(i.id)}>
                <span><span className="font-mono font-semibold">{i.reference}</span> · {INCIDENT_CATEGORY[i.category]}</span><IncidentStatusBadge status={i.status} /></button></li>))}</ul>
          </section>
        )}

        {/* ---------------- actions ---------------- */}
        {b.status === 'awaiting_provider' && role === 'hotel_staff' && <p className="rounded-lg bg-amber/10 px-3 py-2 text-sm text-amber-ink">Waiting for {provider?.name} to accept. You can change the provider if they can’t take it.</p>}
        <section className="space-y-3 border-t border-slate-200 pt-4" aria-label="Actions">
          {canConfirm && mode === null && (
            <div className="space-y-2 rounded-xl bg-teal/5 p-3">
              <p className="text-sm font-semibold">Confirm this request</p>
              <Field label={b.price_type === 'on_request' ? 'Agreed price (required)' : 'Set an agreed price (optional)'} hint={`Currently: ${PRICE_TYPE[b.price_type]}${b.price_type !== 'on_request' ? ` · ${p.amount}` : ''}`}>
                <input type="number" min="1" max="20000" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Rand amount" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={confirm}><CheckCircle2 className="size-4" aria-hidden />Confirm booking</Button>
                <Button variant="outline" onClick={() => setMode('decline')}>Decline</Button>
              </div>
            </div>
          )}
          {mode === 'decline' && <ReasonForm label={role === 'provider_staff' ? 'Why can’t you take this trip? The hotel will arrange another option.' : 'Reason (sent to the guest)'} cta="Decline" onCancel={() => setMode(null)}
            onSubmit={(r) => run(() => rpc('decline_booking', { p_booking: b.id, p_reason: r }), 'Booking declined')} />}

          {canAssign && mode === null && (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><UserCheck className="size-4" aria-hidden />{driver && asg.active ? 'Reassign driver' : 'Assign an approved driver'}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Driver"><select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">Choose…</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></Field>
                <Field label="Vehicle"><select className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Choose…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.colour} {v.make} {v.model} · {v.registration}</option>)}</select></Field>
              </div>
              {drivers.length === 0 && <p className="text-xs text-alert-ink">{provider?.name} has no approved drivers{role === 'hotel_staff' ? ' you can see' : ''}.</p>}
              <Button onClick={assign} disabled={!driverId || !vehicleId}>Assign &amp; send code</Button>
              <p className="text-xs text-muted">A new random one-time code is generated and goes straight to the guest’s and driver’s WhatsApp. Reassigning cancels the old code.</p>
            </div>
          )}

          {mode === null && (
            <div className="flex flex-wrap gap-2">
              {b.status === 'driver_assigned' && <Button variant="outline" size="sm" onClick={() => status('driver_on_way')}><Navigation className="size-4" aria-hidden />Driver on the way</Button>}
              {b.status === 'driver_on_way' && <Button variant="outline" size="sm" onClick={() => status('driver_arrived')}><MapPin className="size-4" aria-hidden />Driver arrived</Button>}
              {b.status === 'in_progress' && <Button variant="safe" size="sm" onClick={() => status('completed')}><Flag className="size-4" aria-hidden />Mark completed</Button>}
              {['driver_assigned', 'driver_on_way', 'driver_arrived'].includes(b.status) && <Button variant="ghost" size="sm" onClick={() => setMode('override')}><Play className="size-4" aria-hidden />Start without guest verification…</Button>}
              {isHotel && ['pending', 'awaiting_provider', 'confirmed'].includes(b.status) && options.length > 1 && <Button variant="outline" size="sm" onClick={() => setMode('option')}><Repeat className="size-4" aria-hidden />Change provider</Button>}
              {!['in_progress', 'completed', 'cancelled'].includes(b.status) && <Button variant="outline" size="sm" onClick={() => setMode('price')}><Tag className="size-4" aria-hidden />Set price</Button>}
              {!['completed', 'cancelled'].includes(b.status) && <Button variant="ghost" size="sm" className="!text-alert-ink" onClick={() => setMode('cancel')}><Ban className="size-4" aria-hidden />Cancel booking</Button>}
            </div>
          )}
          {mode === 'override' && <ReasonForm label="Why is the ride starting without the guest verifying the driver? (Audit-logged.)" cta="Start ride" variant="dark" min={5} onCancel={() => setMode(null)} onSubmit={(r) => status('in_progress', r)} />}
          {mode === 'cancel' && <ReasonForm label="Cancellation reason (sent to the guest)" cta="Cancel booking" onCancel={() => setMode(null)} onSubmit={(r) => run(() => rpc('cancel_booking', { p_booking: b.id, p_reason: r }), 'Booking cancelled; code revoked')} />}
          {mode === 'price' && (
            <form className="flex items-end gap-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); run(() => rpc('set_booking_price', { p_booking: b.id, p_amount: Number(price) }), `Agreed price set to ${rand(price)}`) }}>
              <Field label="Agreed price (Rand)"><input type="number" min="1" max="20000" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} required /></Field>
              <Button type="submit">Save</Button><Button variant="outline" onClick={() => setMode(null)}>Back</Button>
            </form>
          )}
          {mode === 'option' && (
            <form className="space-y-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); run(() => rpc('change_booking_option', { p_booking: b.id, p_partner: option }), 'Provider changed; guest notified') }}>
              <Field label="Transport option"><select className={inputCls} value={option} onChange={(e) => setOption(e.target.value)} required>
                <option value="">Choose…</option>
                {options.filter((o) => o.id !== b.partner_id).map((o) => { const pr = ops.ix.provider[o.provider_id]; return <option key={o.id} value={o.id}>{pr?.name} · {o.vehicle_class} · {priceInfo(o).amount}</option> })}
              </select></Field>
              <div className="flex gap-2"><Button type="submit">Change</Button><Button variant="outline" onClick={() => setMode(null)}>Back</Button></div>
            </form>
          )}
          {provider && provider.status !== 'active' && <p className="flex items-center gap-2 text-xs">Provider status: <PartnerStatusBadge status={provider.status} /></p>}
        </section>
      </div>
    </Modal>
  )
}
