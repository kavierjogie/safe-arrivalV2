import { useState } from 'react'
import { useOps } from '../../hooks/useOps'
import { useLive } from '../../context/AppContext'
import { rpc } from '../../services/api'
import { PageHeader } from '../../components/layout/Layouts'
import { DemoTag, Panel, Spinner, StatCard, inputW } from '../../components/common/ui'
import { HBarChart, TrendChart, weeklyCounts } from '../../components/common/Charts'
import { BadgeCheck, Banknote, BedDouble, Car, ShieldAlert } from 'lucide-react'
import { INCIDENT_CATEGORY, SERVICE, VERIFY_FAILURES, VERIFY_OUTCOME } from '../../lib/labels'

const count = (rows, key, label) => Object.entries(rows.reduce((m, r) => { const k = key(r); if (k) m[k] = (m[k] ?? 0) + 1; return m }, {}))
  .map(([k, value]) => ({ name: label(k), value })).sort((a, b) => b.value - a.value)

const OUTCOME = { verified_partner: 'Verified partner', not_approved: 'Not approved / under review', not_found: 'Not in records', contact_mismatch: 'Contact details mismatch' }
const pct = (v) => (v == null ? '—' : `${v}%`)

/** Accommodation + transport safety analytics, aggregated in the database (admin_safety_analytics). */
function ServiceAnalytics() {
  const [days, setDays] = useState(90)
  const { data: a, error } = useLive(() => rpc('admin_safety_analytics', { p_days: days }), [days])
  if (error) return <p className="mt-6 text-sm text-alert-ink">Could not load accommodation & transport analytics: {error.message}</p>
  if (!a) return <Spinner />
  const checks = (svc) => a.checks.filter((c) => c.service === svc)
  const rate = (svc) => { const c = checks(svc); const n = c.reduce((t, x) => t + x.count, 0); return n ? Math.round((100 * (c.find((x) => x.outcome === 'verified_partner')?.count ?? 0)) / n) : null }
  const simulated = a.checks.reduce((t, x) => t + x.simulated, 0)
  const cats = (svc) => a.incidents_by_category.filter((c) => c.service === svc).map((c) => ({ name: INCIDENT_CATEGORY[c.category] ?? c.label, value: c.count }))
  const total = (svc) => a.incidents_by_category.filter((c) => c.service === svc).reduce((t, x) => t + x.count, 0)
  return (
    <section className="mt-10" aria-labelledby="svc-analytics">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="svc-analytics" className="text-lg font-semibold">Accommodation & transport safety</h2>
          <p className="text-sm text-muted">Checks made on WhatsApp and through ChatGPT/MCP, verification outcomes and reports, side by side.</p>
        </div>
        <label className="text-sm">Period <select className={inputW('w-auto')} value={days} onChange={(e) => setDays(+e.target.value)}>
          {[30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></label>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Accommodation checks: verified partner" value={pct(rate('accommodation'))} icon={BedDouble} tone="teal" hint={`${checks('accommodation').reduce((t, x) => t + x.count, 0)} checks`} />
        <StatCard label="Transport verification rate" value={pct(a.transport_verification.rate)} icon={BadgeCheck} tone="green" hint="Driver checks passed at pickup" />
        <StatCard label="Accommodation reports" value={total('accommodation')} icon={BedDouble} tone="amber" />
        <StatCard label="Transport reports" value={total('transport')} icon={Car} tone="amber" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Accommodation check outcomes" bodyClass="p-4"><HBarChart label="Checks" data={checks('accommodation').map((c) => ({ name: OUTCOME[c.outcome], value: c.count, color: c.outcome === 'verified_partner' ? undefined : '#D97706' }))} /></Panel>
        <Panel title="Transport company check outcomes" bodyClass="p-4"><HBarChart label="Checks" data={checks('transport').map((c) => ({ name: OUTCOME[c.outcome], value: c.count, color: c.outcome === 'verified_partner' ? undefined : '#D97706' }))} /></Panel>
        <Panel title="Accommodation reports by type" bodyClass="p-4">{cats('accommodation').length ? <HBarChart label="Reports" data={cats('accommodation')} /> : <p className="text-sm text-muted">No accommodation reports in this period.</p>}</Panel>
        <Panel title="Transport reports by type" bodyClass="p-4"><HBarChart label="Reports" height={260} data={cats('transport')} /></Panel>
        <Panel title="Repeated complaints about the same provider" bodyClass="divide-y divide-slate-100 text-sm">
          {a.repeated_subjects.map((r) => (
            <div key={r.service + r.name} className="p-3"><p className="font-medium">{r.name} <span className="text-muted">· {SERVICE[r.service]} · {r.count} reports</span></p>
              <p className="text-xs text-muted">{r.categories.map((c) => INCIDENT_CATEGORY[c] ?? c).join(' · ')}</p></div>))}
          {!a.repeated_subjects.length && <p className="p-3 text-muted">No provider has two or more reports in this period.</p>}
        </Panel>
        <Panel title="Reports by location" bodyClass="p-4"><HBarChart label="Reports" height={260} data={a.locations.slice(0, 10).map((l) => ({ name: `${l.location.replace('Cape Town International Airport', 'CPT')} (${l.service === 'accommodation' ? 'acc.' : 'transport'})`, value: l.count }))} /></Panel>
        <Panel title="Weekly reports: accommodation" bodyClass="p-4"><TrendChart label="Reports" data={a.weekly.map((w) => ({ name: w.week, value: w.accommodation }))} /></Panel>
        <Panel title="Weekly reports: transport" bodyClass="p-4"><TrendChart label="Reports" data={a.weekly.map((w) => ({ name: w.week, value: w.transport }))} /></Panel>
      </div>
      <p className="mt-3 text-xs text-muted">{simulated ? `${simulated} of the checks in this period are simulated demo data. ` : ''}Reports are unverified until the safety team reviews them; counts are not proof that a provider is unsafe.</p>
    </section>
  )
}

export default function AdminAnalyticsPage() {
  const ops = useOps()
  const inc = ops.incidents
  const fails = ops.verification_attempts.filter((a) => VERIFY_FAILURES.includes(a.outcome))
  const payment = inc.filter((i) => i.category === 'extra_payment')
  return (
    <>
      <PageHeader title="Incident analytics" subtitle="Where and how tourists report problems. Use it to target safety interventions."><DemoTag>Sample data</DemoTag></PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Payment-related complaints" value={payment.length} icon={Banknote} tone="amber" hint={`${Math.round((payment.length / Math.max(1, inc.length)) * 100)}% of reports`} />
        <StatCard label="Driver verification failures" value={fails.length} icon={ShieldAlert} tone="red" hint={`of ${ops.verification_attempts.filter((a) => !a.outcome.startsWith('spoken')).length} verifications`} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Most frequently reported incident types" bodyClass="p-4"><HBarChart data={count(inc, (i) => i.category, (k) => INCIDENT_CATEGORY[k])} label="Reports" height={260} /></Panel>
        <Panel title="Incidents over time (weekly)" bodyClass="p-4"><TrendChart data={weeklyCounts(inc, 8)} label="Reports" height={260} /></Panel>
        <Panel title="Incidents by pickup location" bodyClass="p-4"><HBarChart data={count(inc, (i) => i.pickup_point_id, (k) => ops.ix.point[k]?.name.replace('Cape Town International Airport', 'CPT') ?? k)} label="Reports" /></Panel>
        <Panel title="Incidents by transport provider" bodyClass="p-4"><HBarChart data={count(inc, (i) => i.provider_id ?? 'none', (k) => ops.ix.provider[k]?.name ?? 'No booking / unknown')} label="Reports" /></Panel>
        <Panel title="Driver verification failures by type" bodyClass="p-4"><HBarChart data={count(fails, (a) => a.outcome, (k) => VERIFY_OUTCOME[k])} label="Failures" /></Panel>
        <Panel title="Payment-related complaints (weekly)" bodyClass="p-4"><TrendChart data={weeklyCounts(payment, 8)} label="Complaints" /></Panel>
      </div>
      <p className="mt-4 text-xs text-muted">Counts are of tourist reports, which are unverified until investigated. Demonstration data is fictional.</p>
      <ServiceAnalytics />
    </>
  )
}
