import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Database, FlaskConical, Loader2, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { backend } from '../../services/api'

export function Logo({ light = false, compact = false }) {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Safe Arrival CPT home">
      <span className="grid size-8 place-items-center rounded-lg bg-teal text-white"><ShieldCheck className="size-5" aria-hidden /></span>
      {!compact && <span className={light ? 'text-white' : 'text-navy'}>Safe Arrival <span className={light ? 'text-teal' : 'text-teal-ink'}>CPT</span></span>}
    </Link>
  )
}

export function ConnectionIndicator({ light = false }) {
  const { dbReady } = useApp()
  const [Icon, label, dot] = !dbReady ? [Loader2, 'Starting demo database…', 'bg-amber']
    : backend === 'supabase' ? [Database, 'Supabase · live', 'bg-safe'] : [FlaskConical, 'Demo mode · in-browser database', 'bg-amber']
  return (
    <span role="status" title={backend === 'local' ? 'The real Supabase SQL (schema, RLS, RPCs) running in your browser. Shared across tabs.' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${light ? 'bg-white/10 text-white' : 'bg-white text-navy ring-1 ring-slate-200'}`}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      <Icon className={`size-3.5 ${!dbReady ? 'animate-spin' : ''}`} aria-hidden />
      {label}
    </span>
  )
}

const BTN = {
  primary: 'bg-teal text-white hover:bg-teal-ink shadow-sm',
  dark: 'bg-navy text-white hover:bg-deep',
  outline: 'bg-white text-navy ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  ghost: 'text-navy hover:bg-slate-100',
  danger: 'bg-alert text-white hover:bg-alert-ink',
  safe: 'bg-safe text-white hover:bg-safe-ink',
}
export function Button({ variant = 'primary', size = 'md', className = '', as: As = 'button', ...props }) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-5 py-3 text-base' : 'px-4 py-2 text-sm'
  return <As {...(As === 'button' ? { type: 'button' } : {})} {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BTN[variant]} ${sz} ${className}`} />
}

/** Native <dialog> modal: focus trapping, Esc and backdrop handled by the browser. */
export function Modal({ open, onClose, title, children, drawer = false, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={`${drawer ? 'drawer w-full max-w-xl rounded-none' : `w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl`} bg-white p-0 text-navy shadow-2xl`}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', variant = 'primary' }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={variant} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}

export const Skeleton = ({ className = '' }) => <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} aria-hidden />

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {Icon && <span className="mb-3 grid size-11 place-items-center rounded-full bg-slate-100 text-muted"><Icon className="size-5" aria-hidden /></span>}
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  )
}

export function StatCard({ label, value, icon: Icon, tone = 'teal', hint }) {
  const tones = { teal: 'text-teal-ink bg-teal/10', green: 'text-safe-ink bg-safe/10', amber: 'text-amber-ink bg-amber/15', red: 'text-alert-ink bg-alert/10', navy: 'text-deep bg-deep/10' }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{label}</p>
        {Icon && <span className={`grid size-8 place-items-center rounded-lg ${tones[tone]}`}><Icon className="size-4" aria-hidden /></span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Panel({ title, action, children, className = '', bodyClass = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export const DemoTag = ({ children = 'Demo data' }) => (
  <span className="inline-flex items-center gap-1 rounded-md bg-amber/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-ink">
    <FlaskConical className="size-3" aria-hidden />{children}
  </span>
)

export const Field = ({ label, children, hint }) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
  </label>
)

export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy placeholder:text-slate-400 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30'

/** Input classes with a non-full width, e.g. inputW('w-auto'). */
export const inputW = (w) => inputCls.replace('w-full', w)

export const textareaCls = inputCls + ' min-h-24'

/** Small labelled value used in detail panels. */
export const Info = ({ label, children, className = '' }) => (
  <div className={className}>
    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
    <dd className="mt-0.5 text-sm font-medium">{children ?? '—'}</dd>
  </div>
)

export function Spinner({ label = 'Loading…' }) {
  return <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />{label}</p>
}
