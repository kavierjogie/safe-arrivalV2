import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, Car, Check, Clock, Info, MessageSquareWarning, Phone, ShieldAlert, Siren } from 'lucide-react'
import { photoUrl } from '../../services/api'
import { t } from '../../i18n'
import { BOOKING_FLOW, BOOKING_STATUS, EMERGENCY_NUMBERS, fmt, initials, priceInfo } from '../../lib/labels'

/** Driver photo, or a clearly-labelled illustrated placeholder for seeded demo drivers. */
export function DriverPhoto({ path, name, size = 'size-16' }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let live = true; photoUrl('driver-photos', path).then((u) => live && setUrl(u)); return () => { live = false } }, [path])
  if (url) return <img src={url} alt={`Photo of ${name}`} className={`${size} shrink-0 rounded-2xl object-cover ring-2 ring-white`} />
  return (
    <span className={`${size} relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-deep to-teal text-white ring-2 ring-white`} role="img" aria-label={`Placeholder photo for ${name}`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full opacity-25" aria-hidden><circle cx="32" cy="24" r="12" fill="#fff" /><path d="M8 64c2-14 12-22 24-22s22 8 24 22z" fill="#fff" /></svg>
      <span className="relative text-lg font-bold">{initials(name)}</span>
    </span>
  )
}

export function DriverCard({ driver, provider, compact = false }) {
  if (!driver) return null
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <DriverPhoto path={driver.photo_path} name={driver.full_name} size={compact ? 'size-12' : 'size-16'} />
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-lg font-semibold">{driver.full_name}<BadgeCheck className="size-5 text-teal" aria-label="Approved driver" /></p>
          <p className="text-sm text-muted">{provider?.name}</p>
          {driver.phone && <a href={`tel:${driver.phone.replace(/\s/g, '')}`} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-teal-ink"><Phone className="size-3.5" aria-hidden />{driver.phone}</a>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[11px] uppercase tracking-wide text-muted">Vehicle</dt><dd className="flex items-center gap-1 font-semibold"><Car className="size-4 text-muted" aria-hidden />{driver.make} {driver.model}</dd></div>
        <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[11px] uppercase tracking-wide text-muted">Colour</dt><dd className="font-semibold">{driver.colour}</dd></div>
        <div className="col-span-2 rounded-xl bg-amber/10 px-3 py-2 ring-1 ring-amber/30">
          <dt className="text-[11px] uppercase tracking-wide text-amber-ink">Registration: check this first</dt>
          <dd className="font-mono text-2xl font-bold tracking-wider">{driver.registration}</dd>
        </div>
      </dl>
    </div>
  )
}

/** The one-time code + the rule. Shown only on the tourist's own booking page. */
export function CodeCard({ code, expiresAt, status }) {
  if (!code) {
    const msg = { used: 'Your code was used when you verified your driver.', expired: 'Your code has expired. Contact your hotel before getting into any vehicle.', revoked: 'Your code was cancelled. Do not get into any vehicle claiming to be this booking.' }[status]
    return msg ? <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{msg}</p> : null
  }
  return (
    <div className="overflow-hidden rounded-2xl bg-navy text-white">
      <div className="px-4 pb-4 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal">{t('trip.codeTitle')}</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wide sm:text-4xl" aria-label={`Verification code ${code}`}>{code}</p>
        {expiresAt && <p className="mt-1 flex items-center gap-1 text-xs text-white/70"><Clock className="size-3.5" aria-hidden />Valid once, until {fmt(expiresAt, 'HH:mm, d MMM')}</p>}
      </div>
      <div className="bg-amber px-4 py-3 text-navy">
        <p className="flex items-start gap-2 text-sm font-semibold"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('trip.codeRule')}</p>
        <p className="mt-1 pl-6 text-sm">{t('trip.codeRuleDetail')}</p>
      </div>
    </div>
  )
}

export function PriceCard({ booking }) {
  const p = priceInfo(booking)
  if (!p) return null
  const tone = { green: 'border-safe/30 bg-safe/5', amber: 'border-amber/40 bg-amber/10', slate: 'border-slate-200 bg-slate-50' }[p.tone]
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{p.label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{p.amount}</p>
      <p className="mt-1 text-sm text-slate-700">{p.note}</p>
      {booking.payment_arrangement && <p className="mt-2 border-t border-black/5 pt-2 text-sm"><span className="font-medium">Payment: </span>{booking.payment_arrangement}</p>}
      {booking.external_simulated && <p className="mt-2 flex gap-1.5 text-xs text-amber-ink"><Info className="mt-px size-3.5 shrink-0" aria-hidden />Uber Central is simulated in this demo ({booking.external_ref}). No real Uber trip has been requested.</p>}
    </div>
  )
}

export function StatusStepper({ status }) {
  if (status === 'cancelled') return <p className="rounded-xl bg-slate-100 p-3 text-sm font-medium">This booking was cancelled.</p>
  const flow = status === 'awaiting_provider' ? ['awaiting_provider', ...BOOKING_FLOW.slice(1)] : BOOKING_FLOW
  const idx = flow.indexOf(status)
  return (
    <ol className="grid grid-cols-7 gap-1" aria-label={`Booking status: ${BOOKING_STATUS[status]}`}>
      {flow.map((s, i) => (
        <li key={s} className="min-w-0">
          <span className={`block h-1.5 rounded-full ${i <= idx ? 'bg-teal' : 'bg-slate-200'}`} aria-hidden />
          <span className={`mt-1 hidden truncate text-[10px] sm:block ${i === idx ? 'font-semibold text-navy' : 'text-muted'}`}>{BOOKING_STATUS[s]}</span>
          {i === idx && <span className="sr-only">Current step: {BOOKING_STATUS[s]}</span>}
        </li>
      ))}
    </ol>
  )
}

export function SomethingWrongButton({ to = '/report', className = '' }) {
  return (
    <Link to={to} className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-alert px-5 py-4 text-base font-bold uppercase tracking-wide text-white shadow-lg shadow-alert/25 hover:bg-alert-ink ${className}`}>
      <ShieldAlert className="size-5" aria-hidden />{t('trip.somethingWrong')}
    </Link>
  )
}

export function EmergencyNumbers({ compact = false }) {
  return (
    <ul className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-3'}`}>
      {EMERGENCY_NUMBERS.map(({ label, number }) => (
        <li key={number}>
          <a href={`tel:${number}`} className="flex items-center gap-3 rounded-xl border border-alert/30 bg-alert/5 px-3 py-2.5 hover:bg-alert/10">
            <Siren className="size-5 text-alert-ink" aria-hidden />
            <span><span className="block text-xs text-slate-600">{label}</span><span className="text-lg font-bold tabular-nums text-alert-ink">{number}</span></span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function Checklist({ items }) {
  return (
    <ul className="space-y-2">
      {items.map((t) => <li key={t} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-safe" aria-hidden />{t}</li>)}
    </ul>
  )
}

export function WhatsAppMessages({ messages }) {
  if (!messages?.length) return null
  return (
    <ol className="chat-pattern space-y-2 rounded-2xl p-3">
      {messages.map((m) => (
        <li key={m.id} className="max-w-[92%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm shadow-sm">
          <p className="whitespace-pre-line leading-snug">{m.body}</p>
          <p className="mt-1 text-right text-[10px] text-muted">{fmt(m.created_at, 'd MMM HH:mm')}</p>
        </li>
      ))}
    </ol>
  )
}

export const ReportHint = () => (
  <p className="flex gap-2 text-xs text-muted"><MessageSquareWarning className="size-4 shrink-0" aria-hidden />Reports get an internal reference immediately. This platform never issues police case numbers. For a crime, also report it to SAPS (10111).</p>
)
