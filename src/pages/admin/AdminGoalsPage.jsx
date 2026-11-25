import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { rpc } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PageHeader } from '../../components/layout/Layouts'
import { Button, ConfirmDialog, EmptyState, Field, Modal, Panel, Spinner, inputCls } from '../../components/common/ui'
import { Badge } from '../../components/common/StatusBadges'
import { GOAL_STATUS, KPI, fmt } from '../../lib/labels'

const CATEGORY = { overall: 'Overall platform', accommodation: 'Accommodation', transport: 'Transport' }
const val = (v, kpi) => (v == null ? '—' : `${Number(v).toLocaleString('en-ZA', { maximumFractionDigits: 2 })}${KPI[kpi][1] === '%' ? '%' : ` ${KPI[kpi][1]}`}`)
const quarter = () => {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3)
  return [new Date(Date.UTC(d.getFullYear(), q * 3, 1)), new Date(Date.UTC(d.getFullYear(), q * 3 + 3, 0))].map((x) => x.toISOString().slice(0, 10))
}

function GoalForm({ goal, onClose }) {
  const [start, end] = quarter()
  const [g, setG] = useState(goal ?? { name: '', category: 'overall', kpi: 'avg_safety_rating', baseline: '', target: '', period_start: start, period_end: end, notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setG((x) => ({ ...x, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await rpc('save_goal', { p: g }); toast.success('Goal saved'); onClose() } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Goal name"><input className={inputCls} required minLength={3} maxLength={120} value={g.name} onChange={set('name')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Applies to"><select className={inputCls} value={g.category} onChange={set('category')}>
          {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Measure (KPI)"><select className={inputCls} value={g.kpi} onChange={set('kpi')}>
          {Object.entries(KPI).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={`Baseline (${KPI[g.kpi][1]})`}><input className={inputCls} type="number" step="any" required value={g.baseline} onChange={set('baseline')} /></Field>
        <Field label={`Target (${KPI[g.kpi][1]})`} hint="Lower than the baseline means lower is better"><input className={inputCls} type="number" step="any" required value={g.target} onChange={set('target')} /></Field>
        <Field label="Period start"><input className={inputCls} type="date" required value={g.period_start} onChange={set('period_start')} /></Field>
        <Field label="Period end"><input className={inputCls} type="date" required min={g.period_start} value={g.period_end} onChange={set('period_end')} /></Field>
      </div>
      <Field label="Notes (optional)"><input className={inputCls} maxLength={500} value={g.notes ?? ''} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Save goal</Button></div>
    </form>
  )
}

/** Safety team: configurable goals; current values are measured live in the database. */
export default function AdminGoalsPage() {
  const [sim, setSim] = useState(false)
  const [editing, setEditing] = useState(null) // null | {} (new) | goal
  const [deleting, setDeleting] = useState(null)
  const { data, error, loading } = useLive(() => rpc('admin_goals', { p_include_simulated: sim }), [sim])
  if (loading && !data) return <Spinner />
  if (error || !data) return <p className="text-sm text-alert-ink">Could not load goals: {error?.message}</p>

  const remove = async (g) => {
    try { await rpc('delete_goal', { p_id: g.id }); toast.success('Goal deleted') } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <PageHeader title="Goals & targets" subtitle="Set baselines and targets for accommodation, transport and the whole platform. Current values are calculated from live records.">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal" checked={sim} onChange={(e) => setSim(e.target.checked)} />Include simulated feedback & checks</label>
        <Button onClick={() => setEditing({})}><Plus className="size-4" aria-hidden />New goal</Button>
      </PageHeader>
      {sim && <p className="mb-4 rounded-xl bg-amber/15 p-3 text-sm text-amber-ink ring-1 ring-amber/30">Values include simulated (demo) feedback and checks. Switch this off to see real visitor data only.</p>}

      <Panel bodyClass="divide-y divide-slate-100">
        {!data.goals.length && <EmptyState icon={Target} title="No goals yet">Create one to track performance against a target.</EmptyState>}
        {data.goals.map((g) => {
          const [label, tone] = GOAL_STATUS[g.status] ?? [g.status, 'slate']
          const pct = Math.max(0, Math.min(100, Number(g.progress_pct ?? 0)))
          return (
            <div key={g.id} className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">{g.name}<Badge tone={tone}>{label}</Badge><span className="text-xs font-normal text-muted">{CATEGORY[g.category]}</span></p>
                <p className="text-xs text-muted">{KPI[g.kpi][0]} · {fmt(g.period_start, 'd MMM yyyy')} – {fmt(g.period_end, 'd MMM yyyy')}{g.notes ? ` · ${g.notes}` : ''}</p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
                  <span>Baseline <strong>{val(g.baseline, g.kpi)}</strong></span>
                  <span>Target <strong>{val(g.target, g.kpi)}</strong>{g.lower_is_better ? ' (lower is better)' : ''}</span>
                  <span>Current <strong>{val(g.current, g.kpi)}</strong></span>
                </div>
                <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name}: ${pct}% of the way to target`}>
                  <div className={`h-full ${tone === 'red' ? 'bg-alert' : tone === 'amber' ? 'bg-amber' : 'bg-teal'}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">{g.progress_pct == null ? 'No measurements in this period yet.' : `${g.progress_pct}% of the way from baseline to target · ${g.elapsed_pct}% of the period elapsed`}</p>
              </div>
              <div className="flex items-start gap-1">
                <Button variant="outline" size="sm" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}><Pencil className="size-4" aria-hidden /></Button>
                <Button variant="outline" size="sm" onClick={() => setDeleting(g)} aria-label={`Delete ${g.name}`}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
            </div>
          )
        })}
      </Panel>
      <p className="mt-4 text-xs text-muted">Status: achieved when the current value reaches the target; on track when progress keeps pace with the time elapsed (within 80%); otherwise at risk. Safety ratings measure how safe visitors felt, not whether anything is safe. Every change is written to the audit log.</p>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit goal' : 'New goal'} wide>
        {editing !== null && <GoalForm goal={editing.id ? editing : null} onClose={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)} title="Delete goal?"
        message={`“${deleting?.name}” will be removed. Its measurements are not affected.`} confirmLabel="Delete" variant="danger" />
    </>
  )
}
