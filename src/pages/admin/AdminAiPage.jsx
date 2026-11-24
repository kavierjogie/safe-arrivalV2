import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Activity, AlertTriangle, Bell, Bot, Database, Gauge, Megaphone, ShieldBan } from 'lucide-react'
import { rpc, backend } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PageHeader } from '../../components/layout/Layouts'
import { DemoTag, Panel, Spinner, StatCard } from '../../components/common/ui'
import { Badge } from '../../components/common/StatusBadges'
import { HBarChart, TrendChart } from '../../components/common/Charts'
import { MCP_URL, serverHealth } from '../../lib/mcp'
import { ago, fmt } from '../../lib/labels'

const DATASETS = [
  ['incident_reports', 'Traveller reports', 'Unverified and verified transport reports (category, time, approximate place; never the traveller’s words).'],
  ['advisories', 'SafeArrival advisories', 'Advisories published by the safety team.'],
  ['pickup_points', 'Pickup points', 'Designated meeting points and instructions.'],
  ['providers', 'Transport partners', 'Partner status, public contacts and service areas.'],
  ['emergency_contacts', 'Emergency numbers', 'National and Cape Town emergency numbers.'],
  ['safety_advice', 'Safety advice', 'Curated, dated precautions.'],
]
const STATUS_TONE = { ok: 'green', invalid: 'amber', error: 'red', rate_limited: 'amber', unauthorised: 'red', disabled: 'slate' }
const DELIVERY = { delivered: 'Shown on page', queued: 'Queued (WhatsApp)', sent: 'Sent (WhatsApp)', failed: 'Failed (WhatsApp)', not_configured: 'WhatsApp not connected' }

function ServerStatus() {
  const [h, setH] = useState(null)
  useEffect(() => {
    let live = true
    const check = () => serverHealth().then((r) => live && setH(r)).catch((e) => live && setH({ ok: false, error: e.message }))
    check()
    const iv = setInterval(check, 30000)
    return () => { live = false; clearInterval(iv) }
  }, [])
  return (
    <Panel title="MCP server" bodyClass="space-y-2 p-4 text-sm">
      {!h ? <Spinner label="Checking server…" /> : (
        <>
          <Badge tone={h.ok ? 'green' : 'red'} icon={Activity}>{h.ok ? 'Online · database reachable' : `Unavailable${h.error ? `: ${h.error}` : ''}`}</Badge>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-muted">Endpoint</dt><dd className="break-all font-mono">{MCP_URL}</dd></div>
            <div><dt className="text-muted">Version</dt><dd>{h.version ?? '—'}</dd></div>
            <div><dt className="text-muted">Database latency</dt><dd>{h.latency_ms != null ? `${h.latency_ms} ms` : '—'}</dd></div>
            <div><dt className="text-muted">Checked</dt><dd>{h.checked_at ? ago(h.checked_at) : '—'} (live, every 30 s)</dd></div>
          </dl>
        </>
      )}
    </Panel>
  )
}

function DatasetToggles({ datasets, onChange }) {
  const [busy, setBusy] = useState(null)
  const toggle = async (key, on) => {
    setBusy(key)
    try { await rpc('set_mcp_dataset', { p_key: key, p_enabled: on }); toast.success(`${on ? 'Enabled' : 'Disabled'} for AI assistants`); onChange() }
    catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }
  return (
    <Panel title="Datasets available to AI assistants" bodyClass="divide-y divide-slate-100">
      {DATASETS.map(([key, label, hint]) => {
        const on = datasets?.[key] !== false
        return (
          <label key={key} className="flex cursor-pointer items-start justify-between gap-4 p-3 text-sm">
            <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
            <input type="checkbox" role="switch" className="mt-1 size-5 accent-teal" checked={on} disabled={busy === key}
              onChange={(e) => toggle(key, e.target.checked)} aria-label={`${label} available to AI assistants`} />
          </label>
        )
      })}
      <p className="p-3 text-xs text-muted">Changes apply to the next tool call (no deploy) and are written to the audit log.</p>
    </Panel>
  )
}

/** Safety team: how AI assistants use SafeArrival. Real aggregates only; no personal data. */
export default function AdminAiPage() {
  const { data: o, error, loading, reload } = useLive(() => rpc('admin_ai_overview'), [])
  if (loading && !o) return <Spinner />
  if (error || !o) return <p className="text-sm text-alert-ink">Could not load the AI-integrations overview: {error?.message}</p>
  const r = o.requests
  const local = backend === 'local'

  return (
    <>
      <PageHeader title="AI integrations" subtitle="How ChatGPT, Claude and other MCP clients use SafeArrival. Aggregates only, with no personal data.">
        {o.demo_mode && <DemoTag>Demo deployment</DemoTag>}
      </PageHeader>

      {local && (
        <p className="mb-4 flex gap-2 rounded-xl bg-amber/15 p-3 text-sm text-amber-ink ring-1 ring-amber/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          You’re on the in-browser demo database. MCP traffic is recorded only in the shared Supabase deployment, so these counts show this browser’s test activity, not real assistant usage.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Tool calls (24 h)" value={r.last_24h} icon={Bot} tone="teal" hint={`${r.last_7d} in 7 days`} />
        <StatCard label="Failed calls (7 d)" value={r.errors_7d} icon={AlertTriangle} tone="red" hint="Errors + invalid input" />
        <StatCard label="Rate-limit events (7 d)" value={r.rate_limited_7d} icon={Gauge} tone="amber" hint={`${r.unauthorised_7d} unauthorised attempts`} />
        <StatCard label="Reports via AI (7 d)" value={o.reports.from_ai_7d} icon={Megaphone} tone="navy" hint={`${o.reports.awaiting_review} reports awaiting review`} />
        <StatCard label="Active alert subscriptions" value={o.subscriptions.active} icon={Bell} tone="green" hint={`${o.subscriptions.paused} paused · ${o.subscriptions.unsubscribed} unsubscribed`} />
        <StatCard label="Alerts generated (7 d)" value={o.deliveries.last_7d} icon={ShieldBan} tone="teal" hint={o.deliveries.whatsapp_enabled ? 'WhatsApp on' : 'WhatsApp not connected'} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Tool calls per day (14 days)" bodyClass="p-4"><TrendChart data={r.daily} label="Calls" height={220} /></Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Calls by tool (7 days)" bodyClass="p-4">
              {r.by_tool.length ? <HBarChart data={r.by_tool.map((t) => ({ name: t.tool, value: t.calls }))} label="Calls" height={Math.max(160, r.by_tool.length * 30)} /> : <p className="text-sm text-muted">No calls yet.</p>}
            </Panel>
            <Panel title="Calls by client (7 days)" bodyClass="p-4">
              {r.by_client.length ? <HBarChart data={r.by_client} label="Calls" height={Math.max(160, r.by_client.length * 34)} /> : <p className="text-sm text-muted">No calls yet.</p>}
              <p className="mt-2 text-xs text-muted">From each client’s user agent. These are clients, not unique people. No accounts or IPs are stored.</p>
            </Panel>
          </div>
          <Panel title="Tool reliability (7 days)" bodyClass="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-muted"><tr><th className="px-3 py-2">Tool</th><th className="px-3 py-2 text-right">Calls</th><th className="px-3 py-2 text-right">OK</th><th className="px-3 py-2 text-right">Failed</th><th className="px-3 py-2 text-right">Rate-limited</th><th className="px-3 py-2 text-right">Avg DB time</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {r.by_tool.map((t) => <tr key={t.tool}><td className="px-3 py-2 font-mono text-xs">{t.tool}</td><td className="px-3 py-2 text-right">{t.calls}</td><td className="px-3 py-2 text-right">{t.ok}</td><td className="px-3 py-2 text-right">{t.errors}</td><td className="px-3 py-2 text-right">{t.rate_limited}</td><td className="px-3 py-2 text-right">{t.avg_ms != null ? `${t.avg_ms} ms` : '—'}</td></tr>)}
              </tbody>
            </table>
          </Panel>
          <Panel title="Recent safety queries" bodyClass="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-muted"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Tool</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Area (~10 km)</th><th className="px-3 py-2">Result</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {r.recent.map((q, i) => (
                  <tr key={i}><td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{fmt(q.at, 'd MMM HH:mm')}</td><td className="px-3 py-2 font-mono text-xs">{q.tool}</td>
                    <td className="px-3 py-2 text-xs">{q.client}</td><td className="px-3 py-2 font-mono text-xs">{q.area ?? '—'}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS_TONE[q.status] ?? 'slate'}>{q.status.replace('_', ' ')}</Badge></td></tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-muted">Arguments, IPs and free text are never logged. Areas are rounded to about 10 km.</p>
          </Panel>
        </div>

        <div className="space-y-4">
          <ServerStatus />
          <DatasetToggles datasets={o.datasets} onChange={reload} />
          <Panel title="Verification of reports" bodyClass="space-y-1 p-4 text-sm">
            {['unverified', 'verified', 'official_advisory', 'rejected'].map((k) => <p key={k} className="flex justify-between"><span>{k.replace('_', ' ')}</span><strong>{o.reports.by_verification[k] ?? 0}</strong></p>)}
            <p className="pt-2 text-xs text-muted">{o.reports.from_ai_total} reports came in through AI assistants. Publish reviewed reports from Incidents → Public safety intelligence.</p>
          </Panel>
          <Panel title="Alert delivery status" bodyClass="space-y-1 p-4 text-sm">
            {Object.keys(o.deliveries.by_status).length === 0 && <p className="text-muted">No alerts generated yet.</p>}
            {Object.entries(o.deliveries.by_status).map(([k, n]) => <p key={k} className="flex justify-between"><span>{DELIVERY[k] ?? k}</span><strong>{n}</strong></p>)}
            <p className="pt-2 text-xs text-muted">Subscriptions by channel: {Object.entries(o.subscriptions.by_channel).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}</p>
          </Panel>
          <Panel title="Data freshness" bodyClass="space-y-1 p-4 text-sm">
            <p className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><Database className="size-3.5 text-muted" aria-hidden />Latest report</span><span>{o.freshness.latest_report ? ago(o.freshness.latest_report) : '—'}</span></p>
            <p className="flex justify-between gap-2"><span>Latest verification</span><span>{o.freshness.latest_verification ? ago(o.freshness.latest_verification) : '—'}</span></p>
            <p className="flex justify-between gap-2"><span>Emergency numbers reviewed</span><span>{fmt(o.freshness.emergency_contacts, 'd MMM yyyy')}</span></p>
            <p className="flex justify-between gap-2"><span>Safety advice reviewed</span><span>{fmt(o.freshness.safety_advice, 'd MMM yyyy')}</span></p>
            <p className="flex justify-between gap-2"><span>Last AI tool call</span><span>{r.last_at ? ago(r.last_at) : 'none yet'}</span></p>
            <p className="pt-2 text-xs text-muted">Coverage: {o.coverage.map((c) => `${c.name} (${c.radius_km} km)`).join(', ')}.</p>
          </Panel>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Generated {fmt(o.generated_at)}. {o.demo_mode ? 'This deployment holds fictional demo data; all traffic counts are real calls to it.' : ''}</p>
    </>
  )
}
