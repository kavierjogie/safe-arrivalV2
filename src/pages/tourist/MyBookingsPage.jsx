import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardList, FileWarning } from 'lucide-react'
import { rpc } from '../../services/api'
import { useApp, useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { BookingStatusBadge, IncidentStatusBadge } from '../../components/common/StatusBadges'
import { Button, EmptyState, Panel } from '../../components/common/ui'
import { fmt } from '../../lib/labels'
import { myReports, myTrips } from '../../lib/myTrips'

/** Booking history: links remembered on this device, plus account bookings for signed-in tourists. */
export default function MyBookingsPage() {
  const { role } = useApp()
  const { data } = useLive(async () => {
    const saved = await Promise.all(myTrips().map((t) => rpc('get_trip', { p_token: t.token }).then((r) => ({ token: t.token, ...r })).catch(() => null)))
    const account = role === 'tourist' ? await rpc('my_trip_links') : []
    const reports = await Promise.all(myReports().map((r) => rpc('get_incident', { p_token: r.token }).then((x) => ({ token: r.token, ...x })).catch(() => null)))
    const trips = saved.filter(Boolean).map((t) => ({ token: t.token, reference: t.booking.reference, status: t.booking.status, pickup_at: t.booking.pickup_at, hotel: t.hotel.name }))
    for (const a of account) if (!trips.some((t) => t.token === a.access_token)) trips.push({ ...a, token: a.access_token })
    return { trips, reports: reports.filter(Boolean) }
  }, [role])

  return (
    <PublicPage narrow>
      <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
      <p className="mt-1 text-sm text-muted">No account needed. Bookings you made on this device are listed here, and every link is also in your WhatsApp messages.</p>
      <div className="mt-6 space-y-4">
        <Panel title="Transport bookings">
          {data?.trips.length ? (
            <ul className="divide-y divide-slate-100">
              {data.trips.map((t) => (
                <li key={t.token}>
                  <Link to={`/trip/${t.token}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1"><p className="font-mono text-sm font-semibold">{t.reference}</p><p className="text-xs text-muted">{t.hotel} · {fmt(t.pickup_at)}</p></div>
                    <BookingStatusBadge status={t.status} /><ChevronRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ClipboardList} title="No bookings on this device yet"><span className="mt-3 block"><Button as={Link} to="/assistant">Arrange trusted transport</Button></span></EmptyState>
          )}
        </Panel>
        {data?.reports.length > 0 && (
          <Panel title="My reports">
            <ul className="divide-y divide-slate-100">
              {data.reports.map((r) => (
                <li key={r.token}>
                  <Link to={`/incident/${r.token}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <FileWarning className="size-4 text-alert" aria-hidden />
                    <div className="min-w-0 flex-1"><p className="font-mono text-sm font-semibold">{r.incident.reference}</p><p className="text-xs text-muted">{fmt(r.incident.created_at)}</p></div>
                    <IncidentStatusBadge status={r.incident.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </PublicPage>
  )
}
