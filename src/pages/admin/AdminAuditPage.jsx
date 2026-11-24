import { useTables } from '../../context/AppContext'
import { PageHeader } from '../../components/layout/Layouts'
import { EmptyState, Panel } from '../../components/common/ui'
import { fmt } from '../../lib/labels'

export default function AdminAuditPage() {
  const { audit_logs: logs } = useTables(['audit_logs'])
  return (
    <>
      <PageHeader title="Audit log" subtitle="Important administrative and booking actions: who did what, and when. Read-only." />
      <Panel>
        {logs.length === 0 ? <EmptyState title="No audited actions yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Details</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <tr key={l.id}><td className="whitespace-nowrap px-3 py-2">{fmt(l.created_at, 'd MMM HH:mm:ss')}</td><td className="px-3 py-2">{l.actor_label}</td><td className="px-3 py-2 font-medium">{l.action.replaceAll('_', ' ')}</td><td className="px-3 py-2">{l.entity}</td>
                    <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-muted">{JSON.stringify(l.details)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
