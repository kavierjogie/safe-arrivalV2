import { Link } from 'react-router-dom'
import { AlertOctagon, CalendarClock, CheckCircle2, ClipboardList, Hourglass, PlaneLanding } from 'lucide-react'
import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { Panel, StatCard } from '../../components/common/ui'
import { BookingStatusBadge, CategoryBadge, IncidentStatusBadge, UrgentBadge } from '../../components/common/StatusBadges'
import { useDrawers } from '../../components/dashboard/Tables'
import { ACTIVE_BOOKING, INCIDENT_OPEN, ago, fmt } from '../../lib/labels'

/** Shared by the hotel and provider overviews. */
export function OpsOverview({ ops, title, subtitle, bookingsLink, incidentsLink }) {
  const { openBooking, openIncident, drawers } = useDrawers(ops)
  const b = ops.bookings
  const soon = Date.now() + 48 * 3600e3
  const upcoming = b.filter((x) => ACTIVE_BOOKING.includes(x.status) && new Date(x.pickup_at) < soon).sort((x, y) => x.pickup_at.localeCompare(y.pickup_at))
  const pending = b.filter((x) => x.status === 'pending' || x.status === 'awaiting_provider')
  const openInc = ops.incidents.filter((i) => INCIDENT_OPEN.includes(i.status))
  const recent = b.filter((x) => x.status === 'completed').sort((x, y) => (y.completed_at ?? '').localeCompare(x.completed_at ?? '')).slice(0, 5)
  const name = (x) => ops.ix.tourist[x.tourist_id]?.full_name ?? 'Guest'

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Total bookings" value={b.length} icon={ClipboardList} tone="navy" />
        <StatCard label="Arrivals in 48h" value={upcoming.length} icon={PlaneLanding} />
        <StatCard label="Confirmed pickups" value={b.filter((x) => ['confirmed', 'driver_assigned', 'driver_on_way', 'driver_arrived'].includes(x.status)).length} icon={CalendarClock} tone="green" />
        <StatCard label="Pending requests" value={pending.length} icon={Hourglass} tone="amber" />
        <StatCard label="Active incidents" value={openInc.length} icon={AlertOctagon} tone="red" />
        <StatCard label="Completed (all time)" value={b.filter((x) => x.status === 'completed').length} icon={CheckCircle2} tone="green" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Needs attention" action={<Link to={incidentsLink} className="text-xs font-medium text-teal-ink">All incidents</Link>}>
          <ul className="divide-y divide-slate-100">
            {openInc.slice(0, 6).map((i) => (
              <li key={i.id}><button onClick={() => openIncident(i.id)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-alert/5">
                <AlertOctagon className="size-4 text-alert" aria-hidden /><span className="font-mono text-sm font-semibold">{i.reference}</span><CategoryBadge category={i.category} />
                {i.needs_immediate_help && <UrgentBadge />}<span className="ml-auto"><IncidentStatusBadge status={i.status} /></span>
                <span className="w-full pl-6 text-xs text-muted">{ago(i.created_at)}</span></button></li>
            ))}
            {pending.map((x) => (
              <li key={x.id}><button onClick={() => openBooking(x.id)} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50">
                <Hourglass className="size-4 text-amber" aria-hidden /><span><span className="font-mono text-sm font-semibold">{x.reference}</span> <span className="text-sm">{name(x)} · {fmt(x.pickup_at)}</span></span>
                <span className="ml-auto"><BookingStatusBadge status={x.status} /></span></button></li>
            ))}
            {!openInc.length && !pending.length && <li className="px-4 py-8 text-center text-sm text-muted">All caught up</li>}
          </ul>
        </Panel>
        <Panel title="Upcoming arrivals (48h)" action={<Link to={bookingsLink} className="text-xs font-medium text-teal-ink">All bookings</Link>}>
          <ul className="divide-y divide-slate-100">
            {upcoming.map((x) => (
              <li key={x.id}><button onClick={() => openBooking(x.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{fmt(x.pickup_at, 'HH:mm')}<span className="block text-xs font-normal text-muted">{fmt(x.pickup_at, 'EEE d')}</span></span>
                <span className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{name(x)}</span><span className="block truncate text-xs text-muted">{x.reference} · {ops.ix.provider[x.provider_id]?.name}</span></span>
                <BookingStatusBadge status={x.status} /></button></li>
            ))}
            {!upcoming.length && <li className="px-4 py-8 text-center text-sm text-muted">No arrivals in the next 48 hours</li>}
          </ul>
        </Panel>
        <Panel title="Recently completed journeys" className="lg:col-span-2">
          <ul className="divide-y divide-slate-100">
            {recent.map((x) => (
              <li key={x.id}><button onClick={() => openBooking(x.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                <CheckCircle2 className="size-4 text-safe" aria-hidden /><span className="font-mono font-semibold">{x.reference}</span><span>{name(x)}</span><span className="ml-auto text-xs text-muted">{fmt(x.completed_at)}</span></button></li>
            ))}
          </ul>
        </Panel>
      </div>
      {drawers}
    </>
  )
}

export default function HotelOverviewPage() {
  const ops = useOps()
  return <OpsOverview ops={ops} title="Hotel overview" subtitle="Guest transport and safety for your property. Updates live." bookingsLink="/hotel/bookings" incidentsLink="/hotel/incidents" />
}
