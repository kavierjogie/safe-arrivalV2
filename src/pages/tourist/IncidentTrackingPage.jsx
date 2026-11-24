import { useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Building2, Landmark, Phone } from 'lucide-react'
import Timeline from '../../components/common/Timeline'
import { rpc } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { CategoryBadge, IncidentStatusBadge, UrgentBadge } from '../../components/common/StatusBadges'
import { EmptyState, Panel, Spinner } from '../../components/common/ui'
import { EmergencyNumbers } from '../../components/tourist/TripBits'
import { INCIDENT_STATUS } from '../../lib/labels'

export default function IncidentTrackingPage() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const { data, error, loading } = useLive(() => rpc('get_incident', { p_token: token }), [token], { poll: 4000 })

  if (loading && !data) return <PublicPage narrow><Spinner /></PublicPage>
  if (error || !data) return <PublicPage narrow><EmptyState icon={AlertTriangle} title="Report not found">Check the link you received.</EmptyState></PublicPage>
  const i = data.incident

  return (
    <PublicPage narrow>
      <div className="space-y-4">
        {params.get('new') && (
          <div className="rounded-2xl border border-safe/30 bg-safe/5 p-4" role="status">
            <p className="text-lg font-semibold">Your report has been received.</p>
            <p className="mt-1">Reference: <strong className="font-mono">{i.reference}</strong></p>
            <p className="mt-1 text-sm">{data.hotel ? 'Your hotel has been notified. ' : ''}We will keep you updated as your report progresses{data.booking_reference ? ', here and on WhatsApp' : ''}.</p>
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-sm text-muted">{i.reference}{data.booking_reference && ` · booking ${data.booking_reference}`}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Report tracking</h1>
          </div>
          <IncidentStatusBadge status={i.status} />
        </div>
        <div className="flex flex-wrap gap-2"><CategoryBadge category={i.category} />{i.needs_immediate_help && <UrgentBadge />}</div>
        <p className="rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200"><strong>Current status: {INCIDENT_STATUS[i.status]?.[0]}.</strong> {INCIDENT_STATUS[i.status]?.[1]}</p>

        <Panel title="Progress" bodyClass="p-5"><Timeline updates={data.updates} /></Panel>

        <Panel title="Police and emergency services" bodyClass="space-y-3 p-4 text-sm">
          <p className="flex gap-2"><Landmark className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span><strong>{i.reference} is an internal reference, not a police case number.</strong> If a crime was committed, report it to the South African Police Service (SAPS) at the nearest station or call 10111. If you get a SAPS case number, share it with your hotel and they will add it to this report.</span></p>
          {i.police_case_number && <p className="rounded-lg bg-slate-50 px-3 py-2">Official case number you provided: <strong className="font-mono">{i.police_case_number}</strong></p>}
          <EmergencyNumbers />
        </Panel>

        {data.hotel && (
          <Panel title="Your hotel" bodyClass="flex items-center gap-2 p-4 text-sm">
            <Building2 className="size-4 text-muted" aria-hidden /><strong>{data.hotel.name}</strong>
            {data.hotel.phone && <a href={`tel:${data.hotel.phone.replace(/\s/g, '')}`} className="ml-auto inline-flex items-center gap-1 font-medium text-teal-ink"><Phone className="size-4" aria-hidden />{data.hotel.phone}</a>}
          </Panel>
        )}
        <p className="text-xs text-muted">Hotels and the platform will do what they can, but can’t guarantee to resolve every report. Unverified reports are never treated as proof of wrongdoing.</p>
      </div>
    </PublicPage>
  )
}
