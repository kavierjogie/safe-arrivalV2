import { useMemo, useState } from 'react'
import { AlertOctagon, ClipboardList, Search } from 'lucide-react'
import { BookingStatusBadge, CategoryBadge, IncidentStatusBadge, UrgentBadge } from '../common/StatusBadges'
import { EmptyState, inputW } from '../common/ui'
import BookingDrawer from './BookingDrawer'
import IncidentDrawer from './IncidentDrawer'
import { ACTIVE_BOOKING, INCIDENT_OPEN, ago, fmt, priceInfo } from '../../lib/labels'

/** Booking + incident drawers that can open each other. */
export function useDrawers(ops) {
  const [open, setOpen] = useState(null) // { kind, id }
  const drawers = open?.kind === 'booking'
    ? <BookingDrawer ops={ops} bookingId={open.id} onClose={() => setOpen(null)} onOpenIncident={(id) => setOpen({ kind: 'incident', id })} />
    : open?.kind === 'incident'
      ? <IncidentDrawer ops={ops} incidentId={open.id} onClose={() => setOpen(null)} onOpenBooking={(id) => setOpen({ kind: 'booking', id })} />
      : null
  return { openBooking: (id) => setOpen({ kind: 'booking', id }), openIncident: (id) => setOpen({ kind: 'incident', id }), drawers }
}

const FILTERS = {
  action: ['Needs action', (b) => b.status === 'pending' || b.status === 'awaiting_provider' || b.status === 'confirmed'],
  active: ['Upcoming & active', (b) => ACTIVE_BOOKING.includes(b.status)],
  completed: ['Completed', (b) => b.status === 'completed'],
  cancelled: ['Cancelled', (b) => b.status === 'cancelled'],
  all: ['All', () => true],
}

export function BookingsTable({ ops, rows, onOpen, initial = 'active', showHotel = false }) {
  const [filter, setFilter] = useState(initial)
  const [q, setQ] = useState('')
  const list = useMemo(() => rows.filter(FILTERS[filter][1])
    .filter((b) => !q || `${b.reference} ${ops.ix.tourist[b.tourist_id]?.full_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (ACTIVE_BOOKING.includes(a.status) ? a.pickup_at.localeCompare(b.pickup_at) : b.pickup_at.localeCompare(a.pickup_at))), [rows, filter, q, ops])

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {Object.entries(FILTERS).map(([k, [label, fn]]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? 'bg-navy text-white' : 'text-muted hover:bg-slate-100'}`}>
              {label} <span className="tabular-nums opacity-70">{rows.filter(fn).length}</span>
            </button>
          ))}
        </div>
        <label className="relative"><span className="sr-only">Search bookings</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
          <input className={`${inputW('w-56')} pl-8`} placeholder="Reference or guest" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {list.length === 0 ? <EmptyState icon={ClipboardList} title="No bookings here" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Guest</th><th className="px-3 py-2">Pickup</th>{showHotel && <th className="px-3 py-2">Hotel</th>}<th className="px-3 py-2">Provider</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((b) => {
                const t = ops.ix.tourist[b.tourist_id]
                return (
                  <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(b.id)}>
                    <td className="px-3 py-2.5"><button className="font-mono font-semibold text-teal-ink hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(b.id) }}>{b.reference}</button></td>
                    <td className="px-3 py-2.5">{t?.full_name ?? '—'}<span className="block text-xs text-muted">{b.passengers} pax · {b.luggage} bags</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5">{fmt(b.pickup_at)}<span className="block text-xs text-muted">{ops.ix.point[b.pickup_point_id]?.name.split(' · ').at(-1)}</span></td>
                    {showHotel && <td className="px-3 py-2.5">{ops.ix.hotel[b.hotel_id]?.name}</td>}
                    <td className="px-3 py-2.5">{ops.ix.provider[b.provider_id]?.name ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{priceInfo(b).amount}{b.price_type === 'estimate' && <span className="block text-xs text-muted">estimate</span>}</td>
                    <td className="px-3 py-2.5"><BookingStatusBadge status={b.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function IncidentsTable({ ops, rows, onOpen, showHotel = true }) {
  const [filter, setFilter] = useState('open')
  const list = rows.filter((i) => filter === 'all' || (filter === 'urgent' ? i.needs_immediate_help && INCIDENT_OPEN.includes(i.status) : INCIDENT_OPEN.includes(i.status)))
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex gap-1 border-b border-slate-100 p-3" role="tablist">
        {[['open', 'Open'], ['urgent', 'Urgent'], ['all', 'All']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? 'bg-navy text-white' : 'text-muted hover:bg-slate-100'}`}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? <EmptyState icon={AlertOctagon} title="No incidents here" /> : (
        <ul className="divide-y divide-slate-100">
          {list.map((i) => (
            <li key={i.id}>
              <button onClick={() => onOpen(i.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50">
                <span className="font-mono text-sm font-semibold">{i.reference}</span>
                <CategoryBadge category={i.category} />
                {i.needs_immediate_help && INCIDENT_OPEN.includes(i.status) && <UrgentBadge />}
                <span className="ml-auto"><IncidentStatusBadge status={i.status} /></span>
                <span className="w-full text-xs text-muted">{ago(i.created_at)} · {ops.ix.point[i.pickup_point_id]?.name ?? 'Unknown location'}{showHotel && ops.ix.hotel[i.hotel_id] ? ` · ${ops.ix.hotel[i.hotel_id].name}` : ''}{ops.ix.booking[i.booking_id] ? ` · ${ops.ix.booking[i.booking_id].reference}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
