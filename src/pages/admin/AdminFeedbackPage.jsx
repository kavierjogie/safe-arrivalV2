import { useState } from 'react'
import { toast } from 'sonner'
import { Download, MessageSquareText, Percent, ShieldCheck, Smile, ThumbsDown } from 'lucide-react'
import { rpc } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PageHeader } from '../../components/layout/Layouts'
import { Button, DemoTag, EmptyState, Panel, Spinner, StatCard, inputW } from '../../components/common/ui'
import { Badge } from '../../components/common/StatusBadges'
import { HBarChart, TrendChart } from '../../components/common/Charts'
import { CHANNEL, FEEDBACK_QUESTION, SAFETY_SCALE, SERVICE, fmt } from '../../lib/labels'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10)
const num = (v, suffix = '') => (v == null ? '—' : `${Number(v).toLocaleString('en-ZA', { maximumFractionDigits: 2 })}${suffix}`)
const csvCell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

function exportCsv(rows, filters) {
  const cols = ['submitted_at', 'service', 'channel', 'subject', 'overall_rating', 'safety_rating', 'helpful', 'confident', 'use_again', 'answers', 'comment', 'simulated']
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `safearrival-feedback-${today()}.csv` })
  a.click()
  URL.revokeObjectURL(a.href)
  rpc('log_feedback_export', { p: filters }).catch(() => {}) // audit trail; the export itself already happened
}

/** Safety team: visitor feedback from WhatsApp and ChatGPT/MCP. All figures are computed in the database. */
export default function AdminFeedbackPage() {
  const [f, setF] = useState({ service: '', channel: '', from: daysAgo(90), to: today(), min_rating: '1', max_rating: '5', data: 'all' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const { data: r, error, loading } = useLive(() => rpc('admin_feedback_report', { p: f }), [JSON.stringify(f)])

  if (loading && !r) return <Spinner />
  if (error || !r) return <p className="text-sm text-alert-ink">Could not load feedback: {error?.message}</p>
  const s = r.summary

  return (
    <>
      <PageHeader title="Visitor feedback" subtitle="Anonymous feedback collected on WhatsApp and through ChatGPT/MCP after checks, verifications, reports and guidance.">
        {s.simulated > 0 && <DemoTag>{s.real ? `${s.simulated} simulated · ${s.real} real` : 'Simulated data'}</DemoTag>}
      </PageHeader>

      <Panel className="mb-4" bodyClass="flex flex-wrap items-end gap-3 p-3 text-sm">
        <label>Service<br /><select className={inputW('w-auto')} value={f.service} onChange={set('service')}>
          <option value="">All</option>{Object.entries(SERVICE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Channel<br /><select className={inputW('w-auto')} value={f.channel} onChange={set('channel')}>
          <option value="">All</option>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>From<br /><input type="date" className={inputW('w-auto')} value={f.from} max={f.to} onChange={set('from')} /></label>
        <label>To<br /><input type="date" className={inputW('w-auto')} value={f.to} min={f.from} onChange={set('to')} /></label>
        <label>Rating<br />
          <select className={inputW('w-auto')} value={f.min_rating} onChange={set('min_rating')} aria-label="Minimum rating">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
          {' – '}
          <select className={inputW('w-auto')} value={f.max_rating} onChange={set('max_rating')} aria-label="Maximum rating">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <label>Data<br /><select className={inputW('w-auto')} value={f.data} onChange={set('data')}>
          <option value="all">Real + simulated</option><option value="real">Real visitors only</option><option value="simulated">Simulated only</option></select></label>
        <Button variant="outline" size="sm" className="ml-auto" disabled={!r.rows.length}
          onClick={() => { exportCsv(r.rows, f); toast.success(`Exported ${r.rows.length} rows`) }}><Download className="size-4" aria-hidden />Export CSV</Button>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Responses" value={s.submitted} icon={MessageSquareText} hint={`${s.offered} offered`} />
        <StatCard label="Response rate" value={num(s.response_rate, '%')} icon={Percent} tone="navy" />
        <StatCard label="Avg perceived safety" value={num(s.avg_safety, ' / 5')} icon={ShieldCheck} tone="green" hint="1 very unsafe … 5 very safe" />
        <StatCard label="Avg overall experience" value={num(s.avg_overall, ' / 5')} icon={Smile} tone="teal" />
        <StatCard label="Felt more confident" value={num(s.confident_pct, '%')} icon={ShieldCheck} tone="teal" hint={`Helped: ${num(s.helpful_pct, '%')}`} />
        <StatCard label="Negative responses" value={s.negative} icon={ThumbsDown} tone="red" hint="Rating ≤ 2 or a “no” answer" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Accommodation vs transport (averages out of 5)" bodyClass="p-4">
          <HBarChart label="Average" height={200} data={r.by_service.flatMap((x) => [
            ...(x.avg_safety != null ? [{ name: `${SERVICE[x.service]} · safety`, value: Number(x.avg_safety), color: '#0b7a72' }] : []),
            ...(x.avg_overall != null ? [{ name: `${SERVICE[x.service]} · overall`, value: Number(x.avg_overall) }] : [])])} />
        </Panel>
        <Panel title="Negative responses per week" bodyClass="p-4">
          <TrendChart label="Negative" height={200} data={r.weekly.map((w) => ({ name: w.week, value: w.negative }))} />
        </Panel>
        <Panel title="By channel" bodyClass="divide-y divide-slate-100 text-sm">
          {r.by_channel.map((c) => (
            <div key={c.channel} className="flex justify-between p-3"><span>{CHANNEL[c.channel]}</span>
              <span className="tabular-nums text-muted">{c.submitted} of {c.offered} answered ({num(c.response_rate, '%')})</span></div>))}
          {!r.by_channel.length && <p className="p-3 text-muted">No feedback offered in this period.</p>}
        </Panel>
        <Panel title="Recurring complaints" bodyClass="divide-y divide-slate-100 text-sm">
          {r.recurring.map((c) => (
            <div key={c.service + c.subject} className="p-3">
              <p className="font-medium">{c.subject} <span className="text-muted">· {SERVICE[c.service]} · {c.negative} negative</span></p>
              {c.issues.length > 0 && <p className="text-xs text-muted">{c.issues.map((k) => FEEDBACK_QUESTION[k] ?? k).join(' · ')}</p>}
            </div>))}
          {!r.recurring.length && <p className="p-3 text-muted">No provider or accommodation has two or more negative responses in this period.</p>}
        </Panel>
      </div>

      {r.answers.length > 0 && (
        <Panel title="Context questions" className="mt-4" bodyClass="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="p-3">Question</th><th className="p-3">Service</th><th className="p-3 text-right">Yes</th><th className="p-3 text-right">Partly</th><th className="p-3 text-right">No</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{r.answers.map((a) => (
              <tr key={a.service + a.question}><td className="p-3">{FEEDBACK_QUESTION[a.question] ?? a.question}</td><td className="p-3 text-muted">{SERVICE[a.service]}</td>
                <td className="p-3 text-right tabular-nums">{a.yes}</td><td className="p-3 text-right tabular-nums">{a.partly}</td><td className="p-3 text-right tabular-nums">{a.no}</td></tr>))}</tbody>
          </table>
        </Panel>
      )}

      <Panel title={`Responses (${r.rows.length}${r.rows.length === 500 ? ', newest 500' : ''})`} className="mt-4" bodyClass="divide-y divide-slate-100">
        {!r.rows.length && <EmptyState icon={MessageSquareText} title="No feedback matches these filters" />}
        {r.rows.map((x) => (
          <div key={x.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 p-3 text-sm">
            <div className="w-36 shrink-0 text-xs text-muted">{fmt(x.submitted_at)}<br />{CHANNEL[x.channel]}</div>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">{SERVICE[x.service]}{x.subject && <span className="text-muted">· {x.subject}</span>}
                {x.simulated && <Badge tone="amber">Simulated</Badge>}</p>
              <p className="text-xs text-muted">
                {[x.safety_rating && `Safety: ${SAFETY_SCALE[x.safety_rating]}`, x.overall_rating && `Overall: ${x.overall_rating}/5`, x.helpful && `Helped: ${x.helpful}`,
                  x.confident && `More confident: ${x.confident}`, ...Object.entries(x.answers).map(([k, v]) => `${FEEDBACK_QUESTION[k] ?? k}: ${v}`)].filter(Boolean).join(' · ')}
              </p>
              {x.comment && <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2">“{x.comment}”</p>}
            </div>
          </div>
        ))}
      </Panel>
      <p className="mt-4 text-xs text-muted">Safety ratings show how safe visitors <em>felt</em>; they are not proof that a provider or accommodation is safe or unsafe. Feedback is anonymous and separate from incident reports. Comments are deleted after the retention period.</p>
    </>
  )
}
