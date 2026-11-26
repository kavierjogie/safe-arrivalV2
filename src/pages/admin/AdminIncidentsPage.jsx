import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { IncidentsTable, useDrawers } from '../../components/dashboard/Tables'
import { INCIDENT_OPEN } from '../../lib/labels'

/** Case-management overview: counts straight from the incidents the safety team can see. */
function Overview({ rows }) {
  const open = rows.filter((i) => INCIDENT_OPEN.includes(i.status))
  const n = (fn, from = rows) => from.filter(fn).length
  const tiles = [
    ['Total reports', rows.length], ['Critical (open)', n((i) => i.priority === 'critical', open), 'text-alert-ink'],
    ['Urgent (open)', n((i) => i.priority === 'urgent', open), 'text-amber-ink'], ['Unassigned (open)', n((i) => !i.handler_id, open)],
    ['In progress', n((i) => ['assigned', 'in_progress', 'follow_up'].includes(i.status))], ['Escalated', n((i) => ['escalated', 'referred_authorities'].includes(i.status))],
    ['Awaiting visitor', n((i) => ['awaiting_visitor', 'unable_to_contact'].includes(i.status))],
    ['Awaiting partner', n((i) => ['awaiting_partner', 'hotel_pending', 'hotel_notified', 'provider_notified'].includes(i.status))],
    ['Resolved', n((i) => i.status === 'resolved')], ['Closed', n((i) => i.status === 'closed')],
  ]
  return (
    <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tiles.map(([label, value, tone = '']) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
          <dt className="text-xs text-muted">{label}</dt><dd className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AdminIncidentsPage() {
  const ops = useOps()
  const { openIncident, drawers } = useDrawers(ops)
  return (
    <>
      <PageHeader title="Incident management" subtitle="Triage by priority, assign a case owner, request information, escalate, resolve and close. Every action is recorded on the case timeline." />
      <Overview rows={ops.incidents} />
      <IncidentsTable ops={ops} rows={ops.incidents} onOpen={openIncident} showOwner />
      {drawers}
    </>
  )
}
