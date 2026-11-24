import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BellOff, BellRing, Pause, Play, ShieldCheck } from 'lucide-react'
import { rpc } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { Badge } from '../../components/common/StatusBadges'
import { Button, ConfirmDialog, EmptyState, Field, Panel, Spinner, inputCls } from '../../components/common/ui'
import { EmergencyNumbers } from '../../components/tourist/TripBits'
import { INCIDENT_CATEGORY, fmt } from '../../lib/labels'

const STATUS = { active: ['teal', 'Active'], paused: ['amber', 'Paused'], expired: ['slate', 'Expired'], unsubscribed: ['slate', 'Unsubscribed'] }
const DELIVERY = { delivered: 'Shown here', queued: 'Sending', sent: 'Sent to WhatsApp', failed: 'WhatsApp send failed', not_configured: 'Shown here (WhatsApp not connected yet)' }

/** A subscriber's private page: their alerts, and pause / change / unsubscribe. Reached only by the manage link. */
export default function AlertsPage() {
  const { token } = useParams()
  const { data, error, loading, reload } = useLive(() => rpc('get_alert_subscription', { p_token: token }), [token], { poll: 4000 })
  const [radius, setRadius] = useState('')
  const [confirm, setConfirm] = useState(false)

  if (loading && !data) return <PublicPage narrow><Spinner /></PublicPage>
  if (error || !data) return <PublicPage narrow><EmptyState icon={BellOff} title="Alert subscription not found">Check the manage link you received.</EmptyState></PublicPage>

  const s = data.subscription
  const live = s.status !== 'unsubscribed'
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); reload?.() } catch (e) { toast.error(e.message) } }
  const update = (p, ok) => act(() => rpc('update_alert_subscription', { p_token: token, p }), ok)

  return (
    <PublicPage narrow>
      <div className="space-y-4">
        {data.data_notice && <p className="rounded-xl bg-amber/15 p-3 text-sm text-amber-ink ring-1 ring-amber/30">{data.data_notice}</p>}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-sm text-muted">{s.reference}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Safety alerts · {s.area}</h1>
          </div>
          <Badge tone={STATUS[s.status]?.[0]} icon={live ? BellRing : BellOff}>{STATUS[s.status]?.[1] ?? s.status}</Badge>
        </div>

        <p className="flex gap-2 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-ink" aria-hidden />
          <span>{s.triggers} SafeArrival monitors this area for you. You don’t need to keep any chat open.</span>
        </p>

        <Panel title={`Alerts (${data.alerts.length})`} bodyClass="divide-y divide-slate-100">
          {data.alerts.length === 0 && <p className="p-4 text-sm text-muted">No alerts yet. That only means nothing has been verified near {s.area} since you subscribed; it is not a safety rating.</p>}
          {data.alerts.map((a) => (
            <article key={a.created_at + a.title} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.type === 'official_advisory' ? 'amber' : 'red'}>{a.type === 'official_advisory' ? 'SafeArrival advisory' : 'Verified incident'}</Badge>
                <span className="text-xs text-muted">{INCIDENT_CATEGORY[a.category] ?? a.category} · {fmt(a.created_at)} · {DELIVERY[a.delivery_status] ?? a.delivery_status}</span>
              </div>
              <p className="whitespace-pre-line text-sm">{a.body}</p>
            </article>
          ))}
        </Panel>

        <Panel title="Your subscription" bodyClass="space-y-3 p-4 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-muted">Area</dt><dd>{s.area} · {s.radius_km} km</dd></div>
            <div><dt className="text-xs text-muted">Channel</dt><dd>{s.channel === 'whatsapp' ? `WhatsApp ${s.whatsapp ?? ''}` : 'This page'}</dd></div>
            <div><dt className="text-xs text-muted">Categories</dt><dd>{s.categories === 'all' ? 'All transport-safety categories' : s.categories.map((c) => INCIDENT_CATEGORY[c] ?? c).join(', ')}</dd></div>
            <div><dt className="text-xs text-muted">Ends</dt><dd>{fmt(s.expires_at)}</dd></div>
          </dl>
          {s.whatsapp_delivery && s.whatsapp_delivery !== 'enabled' && <p className="text-xs text-muted">WhatsApp: {s.whatsapp_delivery}.</p>}
          {live && (
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap gap-2">
                {s.status === 'paused'
                  ? <Button size="sm" variant="outline" onClick={() => update({ status: 'active' }, 'Alerts resumed')}><Play className="size-4" aria-hidden />Resume</Button>
                  : <Button size="sm" variant="outline" onClick={() => update({ status: 'paused' }, 'Alerts paused')}><Pause className="size-4" aria-hidden />Pause</Button>}
                <Button size="sm" variant="outline" onClick={() => update({ extend_days: 14, status: 'active' }, 'Extended for 14 days')}>Extend 14 days</Button>
                <Button size="sm" variant="danger" onClick={() => setConfirm(true)}><BellOff className="size-4" aria-hidden />Unsubscribe</Button>
              </div>
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); update({ radius_km: Number(radius) }, 'Radius updated'); setRadius('') }}>
                <Field label="Change radius (km)"><input className={inputCls} type="number" min="0.5" max="25" step="0.5" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder={String(s.radius_km)} required /></Field>
                <Button type="submit" size="sm" variant="dark">Save</Button>
              </form>
            </div>
          )}
          {!live && <p className="text-muted">You’re unsubscribed. Your phone number and location have been deleted.</p>}
          <p className="text-xs text-muted">Consent recorded {fmt(s.consent_at)}. Anyone with this link can manage these alerts, so keep it private.</p>
        </Panel>

        <Panel title="In an emergency" bodyClass="p-4 text-sm"><p className="mb-3">Alerts are not an emergency service. If you are in danger, call now:</p><EmergencyNumbers /></Panel>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} variant="danger" confirmLabel="Unsubscribe"
        title="Stop these alerts?" message="Your subscription ends now and your phone number and location are deleted. This can’t be undone."
        onConfirm={() => act(() => rpc('unsubscribe_alerts', { p_token: token }), 'Unsubscribed')} />
    </PublicPage>
  )
}
