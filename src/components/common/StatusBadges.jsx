import {
  AlertOctagon, Ban, Car, CheckCircle2, CircleDot, Clock, Eye, Flag, Hourglass, MapPin, Navigation, ShieldAlert,
  ShieldCheck, ShieldQuestion, Siren, UserCheck, XCircle, Building2, Landmark,
} from 'lucide-react'
import { BOOKING_STATUS, INCIDENT_CATEGORY, INCIDENT_STATUS, PARTNER_STATUS, VERIFY_OUTCOME } from '../../lib/labels'

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  teal: 'bg-teal/10 text-teal-ink ring-teal/25',
  green: 'bg-safe/10 text-safe-ink ring-safe/25',
  amber: 'bg-amber/15 text-amber-ink ring-amber/30',
  red: 'bg-alert/10 text-alert-ink ring-alert/25',
  navy: 'bg-deep/10 text-deep ring-deep/20',
}

// Every badge pairs colour with an icon + text so status never relies on colour alone.
export function Badge({ tone = 'slate', icon: Icon, children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  )
}

const B = {
  pending: ['amber', Hourglass], awaiting_provider: ['amber', Clock], confirmed: ['navy', CheckCircle2], driver_assigned: ['teal', UserCheck],
  driver_on_way: ['teal', Navigation], driver_arrived: ['teal', MapPin], in_progress: ['green', Car], completed: ['green', CheckCircle2], cancelled: ['slate', XCircle],
}
export const BookingStatusBadge = ({ status }) => <Badge tone={B[status]?.[0]} icon={B[status]?.[1]}>{BOOKING_STATUS[status] ?? status}</Badge>

const I = {
  received: ['red', CircleDot], hotel_notified: ['amber', Building2], hotel_pending: ['amber', Hourglass], provider_notified: ['amber', Car],
  escalated: ['red', ShieldAlert], referred_authorities: ['navy', Landmark], follow_up: ['teal', Eye], resolved: ['green', CheckCircle2], closed: ['slate', CheckCircle2],
}
export const IncidentStatusBadge = ({ status }) => <Badge tone={I[status]?.[0]} icon={I[status]?.[1]}>{INCIDENT_STATUS[status]?.[0] ?? status}</Badge>

export const CategoryBadge = ({ category }) => <Badge tone="slate" icon={Flag}>{INCIDENT_CATEGORY[category] ?? category}</Badge>
export const UrgentBadge = () => <Badge tone="red" icon={Siren}>Immediate help requested</Badge>

const P = { active: ['green', ShieldCheck], approved: ['green', ShieldCheck], pending: ['amber', ShieldQuestion], suspended: ['red', Ban], rejected: ['slate', XCircle] }
export const PartnerStatusBadge = ({ status }) => <Badge tone={P[status]?.[0]} icon={P[status]?.[1]}>{PARTNER_STATUS[status] ?? status}</Badge>

export const VerifyBadge = ({ outcome }) => {
  const ok = outcome === 'verified' || outcome === 'spoken_code_match'
  return <Badge tone={ok ? 'green' : 'red'} icon={ok ? ShieldCheck : AlertOctagon}>{VERIFY_OUTCOME[outcome] ?? outcome}</Badge>
}
