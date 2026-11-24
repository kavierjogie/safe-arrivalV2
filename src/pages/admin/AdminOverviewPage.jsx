import { Link } from 'react-router-dom'
import { AlertOctagon, Building2, Car, CheckCircle2, ClipboardList, Hourglass, IdCard, ShieldQuestion } from 'lucide-react'
import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { DemoTag, Panel, StatCard } from '../../components/common/ui'
import { CategoryBadge, IncidentStatusBadge, UrgentBadge } from '../../components/common/StatusBadges'
import { useDrawers } from '../../components/dashboard/Tables'
import Patterns from '../../components/dashboard/Patterns'
import { HBarChart } from '../../components/common/Charts'
import { INCIDENT_CATEGORY, INCIDENT_OPEN, ago } from '../../lib/labels'
import { findPatterns } from '../../lib/intelligence'

export default function AdminOverviewPage() {
  const ops = useOps()
  const { openIncident, drawers } = useDrawers(ops)
  const open = ops.incidents.filter((i) => INCIDENT_OPEN.includes(i.status))
  const awaiting = open.filter((i) => ['received', 'hotel_notified', 'hotel_pending'].includes(i.status) || i.needs_immediate_help)
  const pendingApprovals = ops.drivers.filter((d) => d.status === 'pending').length + ops.hotels.filter((h) => h.status === 'pending').length + ops.transport_providers.filter((p) => p.status === 'pending').length
  const byCat = Object.entries(INCIDENT_CATEGORY).map(([k, name]) => ({ name, value: ops.incidents.filter((i) => i.category === k).length })).filter((d) => d.value).sort((a, b) => b.value - a.value)
  const patterns = findPatterns({ incidents: ops.incidents, attempts: ops.verification_attempts, bookings: ops.bookings, points: ops.ix.point, providers: ops.ix.provider })

  return (
    <>
      <PageHeader title="Safety overview" subtitle="Platform-wide view across every hotel, provider and driver."><DemoTag>Includes sample data</DemoTag></PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Registered hotels" value={ops.hotels.length} icon={Building2} tone="navy" hint={`${ops.hotels.filter((h) => h.status === 'active').length} active`} />
        <StatCard label="Approved providers" value={ops.transport_providers.filter((p) => p.status === 'active').length} icon={Car} hint={`${ops.transport_providers.length} registered`} />
        <StatCard label="Registered drivers" value={ops.drivers.length} icon={IdCard} hint={`${ops.drivers.filter((d) => d.status === 'approved').length} approved`} />
        <StatCard label="Tourist bookings" value={ops.bookings.length} icon={ClipboardList} tone="navy" />
        <StatCard label="Completed journeys" value={ops.bookings.filter((b) => b.status === 'completed').length} icon={CheckCircle2} tone="green" />
        <StatCard label="Reported incidents" value={ops.incidents.length} icon={AlertOctagon} tone="red" hint={`${open.length} open`} />
        <StatCard label="Awaiting attention" value={awaiting.length} icon={Hourglass} tone="amber" />
        <StatCard label="Pending approvals" value={pendingApprovals} icon={ShieldQuestion} tone="amber" hint="Hotels, providers, drivers" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Patterns patterns={patterns} onOpenIncident={openIncident} />
        <Panel title="Incidents awaiting attention" action={<Link to="/admin/incidents" className="text-xs font-medium text-teal-ink">All incidents</Link>}>
          <ul className="divide-y divide-slate-100">
            {awaiting.map((i) => (
              <li key={i.id}><button onClick={() => openIncident(i.id)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-slate-50">
                <span className="font-mono text-sm font-semibold">{i.reference}</span><CategoryBadge category={i.category} />{i.needs_immediate_help && <UrgentBadge />}
                <span className="ml-auto"><IncidentStatusBadge status={i.status} /></span>
                <span className="w-full text-xs text-muted">{ago(i.created_at)} · {ops.ix.hotel[i.hotel_id]?.name ?? 'No hotel'}</span></button></li>
            ))}
            {!awaiting.length && <li className="px-4 py-8 text-center text-sm text-muted">Nothing waiting</li>}
          </ul>
        </Panel>
        <Panel title="Incident categories" className="lg:col-span-2" bodyClass="p-4"><HBarChart data={byCat} label="Reports" height={260} /></Panel>
      </div>
      {drawers}
    </>
  )
}
