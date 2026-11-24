import { toast } from 'sonner'
import { AlertTriangle, Car, Clock, Flag, KeyRound, MapPin, Navigation, ShieldCheck, Users } from 'lucide-react'
import { useTables } from '../../context/AppContext'
import { rpc } from '../../services/api'
import { PageHeader } from '../../components/layout/Layouts'
import { Button, EmptyState, Panel } from '../../components/common/ui'
import { BookingStatusBadge } from '../../components/common/StatusBadges'
import { directionsUrl } from '../../components/maps/PickupMap'
import { ACTIVE_BOOKING, fmt } from '../../lib/labels'

/** Driver view: only trips assigned to them (RLS), and the code from their own WhatsApp message. */
export default function DriverTripsPage() {
  const { bookings, notifications, pickup_points: points, vehicles, booking_drivers: asg, loading } = useTables(['bookings', 'notifications', 'pickup_points', 'vehicles', 'booking_drivers'])
  const trips = bookings.filter((b) => ACTIVE_BOOKING.includes(b.status) && b.status !== 'pending').sort((a, b) => a.pickup_at.localeCompare(b.pickup_at))
  const past = bookings.filter((b) => !ACTIVE_BOOKING.includes(b.status)).slice(0, 10)
  const msg = (b) => notifications.find((n) => n.booking_id === b.id && n.kind === 'trip_assigned')
  const status = async (b, s) => {
    try { await rpc('update_trip_status', { p_booking: b.id, p_status: s }); toast.success('Status sent to guest and hotel') } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <PageHeader title="My trips" subtitle="Only trips assigned to you. Never show your code on a sign or screen. Say it to the guest." />
      {!loading && trips.length === 0 && <EmptyState icon={Car} title="No upcoming trips">You’ll get a WhatsApp message when you’re assigned.</EmptyState>}
      <div className="grid gap-4 lg:grid-cols-2">
        {trips.map((b) => {
          const m = msg(b); const p = points.find((x) => x.id === b.pickup_point_id)
          const v = vehicles.find((x) => x.id === asg.find((a) => a.booking_id === b.id && a.active)?.vehicle_id)
          return (
            <Panel key={b.id} title={<span className="font-mono">{b.reference}</span>} action={<BookingStatusBadge status={b.status} />} bodyClass="space-y-3 p-4">
              <dl className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2"><Clock className="size-4 text-muted" aria-hidden /><strong>{fmt(b.pickup_at)}</strong>{b.flight_number && <span className="text-muted">· flight {b.flight_number}</span>}</p>
                <p className="flex items-center gap-2"><Users className="size-4 text-muted" aria-hidden />Guest: <strong>{m?.payload?.guest ?? 'Guest'}</strong> · {b.passengers} pax · {b.luggage} bags</p>
                <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><span><strong>{p?.name}</strong><span className="block text-muted">{p?.description}</span></span></p>
                <p className="flex items-center gap-2"><Navigation className="size-4 text-muted" aria-hidden />To: {b.destination}</p>
                {v && <p className="flex items-center gap-2"><Car className="size-4 text-muted" aria-hidden />{v.colour} {v.make} {v.model} · <span className="font-mono">{v.registration}</span></p>}
              </dl>
              {m?.payload?.code ? (
                <div className="rounded-xl bg-navy p-3 text-white">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal"><KeyRound className="size-3.5" aria-hidden />Say this to the guest first</p>
                  <p className="mt-1 font-mono text-2xl font-bold">{m.payload.code}</p>
                  <p className="mt-1 text-xs text-white/70">From your WhatsApp trip message. The guest checks it against theirs.</p>
                </div>
              ) : b.status === 'in_progress' ? <p className="flex items-center gap-2 rounded-xl bg-safe/10 p-3 text-sm font-medium text-safe-ink"><ShieldCheck className="size-4" aria-hidden />Guest verified you. Ride in progress.</p> : null}
              <div className="flex flex-wrap gap-2">
                {b.status === 'driver_assigned' && <Button onClick={() => status(b, 'driver_on_way')}><Navigation className="size-4" aria-hidden />I’m on my way</Button>}
                {b.status === 'driver_on_way' && <Button onClick={() => status(b, 'driver_arrived')}><MapPin className="size-4" aria-hidden />I’ve arrived</Button>}
                {b.status === 'in_progress' && <Button variant="safe" onClick={() => status(b, 'completed')}><Flag className="size-4" aria-hidden />Trip completed</Button>}
                {p && <Button as="a" href={directionsUrl(p)} target="_blank" rel="noreferrer" variant="outline">Directions</Button>}
              </div>
              {b.status === 'driver_arrived' && <p className="flex items-start gap-2 text-xs text-muted"><AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />The ride starts when the guest confirms your code in their app. You can’t start it yourself.</p>}
            </Panel>
          )
        })}
      </div>
      {past.length > 0 && (
        <Panel title="Recent trips" className="mt-6">
          <ul className="divide-y divide-slate-100 text-sm">{past.map((b) => <li key={b.id} className="flex items-center justify-between px-4 py-2.5"><span className="font-mono">{b.reference}</span><span className="text-muted">{fmt(b.pickup_at)}</span><BookingStatusBadge status={b.status} /></li>)}</ul>
        </Panel>
      )}
    </>
  )
}
