import { useOps } from '../../hooks/useOps'
import { PageHeader } from '../../components/layout/Layouts'
import { DemoTag, Panel, StatCard } from '../../components/common/ui'
import { HBarChart, TrendChart, weeklyCounts } from '../../components/common/Charts'
import { Banknote, ShieldAlert } from 'lucide-react'
import { INCIDENT_CATEGORY, VERIFY_FAILURES, VERIFY_OUTCOME } from '../../lib/labels'

const count = (rows, key, label) => Object.entries(rows.reduce((m, r) => { const k = key(r); if (k) m[k] = (m[k] ?? 0) + 1; return m }, {}))
  .map(([k, value]) => ({ name: label(k), value })).sort((a, b) => b.value - a.value)

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
    </>
  )
}
