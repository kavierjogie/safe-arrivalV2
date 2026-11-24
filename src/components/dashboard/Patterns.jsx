import { Lightbulb, TrendingUp } from 'lucide-react'
import { Badge } from '../common/StatusBadges'
import { DemoTag, EmptyState, Panel } from '../common/ui'

export default function Patterns({ patterns, onOpenIncident }) {
  return (
    <Panel title={<span className="flex items-center gap-2"><TrendingUp className="size-4" aria-hidden />Safety intelligence <DemoTag>Sample data</DemoTag></span>} bodyClass="divide-y divide-slate-100">
      {patterns.length === 0 && <EmptyState icon={TrendingUp} title="No recurring patterns in the last 30 days" />}
      {patterns.map((p) => (
        <div key={p.id} className="space-y-1.5 px-4 py-3">
          <div className="flex items-start gap-2">
            <Badge tone={p.severity === 'high' ? 'red' : 'amber'}>{p.severity === 'high' ? 'High priority' : 'Watch'}</Badge>
            <p className="text-sm font-medium">{p.text}</p>
          </div>
          <p className="flex gap-1.5 text-xs text-slate-600"><Lightbulb className="mt-px size-3.5 shrink-0 text-amber" aria-hidden />{p.action}</p>
          {p.incidentIds.length > 0 && onOpenIncident && (
            <p className="flex flex-wrap gap-1 text-xs">{p.incidentIds.slice(0, 6).map((id, i) => <button key={id} className="rounded bg-slate-100 px-1.5 py-0.5 hover:bg-slate-200" onClick={() => onOpenIncident(id)}>Report {i + 1}</button>)}</p>
          )}
        </div>
      ))}
      <p className="px-4 py-2 text-[11px] text-muted">Patterns are built from unverified tourist reports. They point to where to look and are not evidence of criminal activity.</p>
    </Panel>
  )
}
