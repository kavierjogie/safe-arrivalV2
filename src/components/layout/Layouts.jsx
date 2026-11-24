import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertOctagon, BarChart3, Bell, Car, ClipboardList, FileClock, Handshake, IdCard, LayoutDashboard, LogOut, Menu,
  MessageCircle, QrCode, ShieldCheck, X,
} from 'lucide-react'
import { ConnectionIndicator, Logo } from '../common/ui'
import { useApp, useTables } from '../../context/AppContext'
import { ROLE_LABEL } from '../../config/demoAccounts'
import { ago } from '../../lib/labels'
import { LANGUAGES, getLanguage, setLanguage, t } from '../../i18n'

export function PublicHeader() {
  const [open, setOpen] = useState(false)
  const nav = ({ isActive }) => `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'text-navy' : 'text-muted hover:text-navy'}`
  const links = [['/how-it-works', t('nav.howItWorks')], ['/assistant', t('nav.arrange')], ['/my-bookings', t('nav.myBookings')], ['/safety', t('nav.safety')], ['/login', t('nav.signIn')]]
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {links.map(([to, label]) => <NavLink key={to} to={to} className={nav}>{label}</NavLink>)}
        </nav>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="lang">Language</label>
          <select id="lang" value={getLanguage()} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs">
            {LANGUAGES.map((l) => <option key={l.code} value={l.code} disabled={!l.ready}>{l.label}{l.ready ? '' : ' (soon)'}</option>)}
          </select>
          <span className="hidden sm:block"><ConnectionIndicator /></span>
          <button className="rounded-md p-2 text-navy hover:bg-slate-100 lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Main" className="grid gap-1 border-t border-slate-100 px-4 py-2 lg:hidden">
          {links.map(([to, label]) => <NavLink key={to} to={to} className={nav} onClick={() => setOpen(false)}>{label}</NavLink>)}
        </nav>
      )}
    </header>
  )
}

const NAV = {
  hotel: [['/hotel', 'Overview', LayoutDashboard], ['/hotel/bookings', 'Bookings', ClipboardList], ['/hotel/drivers', 'Approved drivers', IdCard],
    ['/hotel/incidents', 'Incidents', AlertOctagon], ['/hotel/setup', 'QR code & pricing', QrCode]],
  provider: [['/provider', 'Overview', LayoutDashboard], ['/provider/bookings', 'Bookings', ClipboardList], ['/provider/fleet', 'Drivers & vehicles', Car],
    ['/provider/incidents', 'Incidents', AlertOctagon]],
  driver: [['/driver', 'My trips', Car]],
  admin: [['/admin', 'Overview', LayoutDashboard], ['/admin/incidents', 'Incidents', AlertOctagon], ['/admin/partners', 'Partners', Handshake],
    ['/admin/analytics', 'Analytics', BarChart3], ['/admin/audit', 'Audit log', FileClock]],
}

function useOrgName() {
  const { profile } = useApp()
  const { hotels, transport_providers: providers } = useTables(['hotels', 'transport_providers'])
  if (profile?.role === 'admin') return 'Safe Arrival safety team'
  if (profile?.hotel_id) return hotels.find((h) => h.id === profile.hotel_id)?.name
  if (profile?.provider_id) return providers.find((p) => p.id === profile.provider_id)?.name
  return null
}

/** Dashboard notifications for the signed-in organisation, with live toasts. */
function NotificationBell() {
  const { act, role } = useApp()
  const { notifications } = useTables(['notifications'])
  const [open, setOpen] = useState(false)
  const seen = useRef(null)
  const items = notifications.filter((n) => n.channel === 'dashboard' || role === 'driver')
  const unread = items.filter((n) => !n.read_at)

  useEffect(() => {
    const ids = new Set(items.map((n) => n.id))
    if (seen.current) items.filter((n) => !seen.current.has(n.id)).slice(0, 3).forEach((n) => toast.info(n.title, { description: n.body.slice(0, 140) }))
    if (items.length || seen.current) seen.current = ids
  }, [items])

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-navy hover:bg-slate-100" aria-label={`Notifications, ${unread.length} unread`} aria-expanded={open}>
        <Bell className="size-5" />
        {unread.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-alert px-1 text-[10px] font-bold text-white">{unread.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-[600] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread.length > 0 && <button className="text-xs font-medium text-teal-ink" onClick={() => act('mark_notifications_read', { p_ids: unread.map((n) => n.id) })}>Mark all read</button>}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No notifications yet</li>}
            {items.slice(0, 30).map((n) => (
              <li key={n.id} className={`px-3 py-2.5 text-sm ${n.read_at ? '' : 'bg-teal/5'}`}>
                <p className="font-medium">{n.title}</p>
                <p className="line-clamp-3 whitespace-pre-line text-xs text-slate-600">{n.body}</p>
                <p className="mt-0.5 text-[11px] text-muted">{ago(n.created_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Shell for every staff dashboard: sidebar on desktop, tab strip on mobile. */
export function DashboardLayout({ area }) {
  const { profile, signOut } = useApp()
  const navigate = useNavigate()
  const org = useOrgName()
  const items = NAV[area]
  const cls = ({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`
  const out = async () => { await signOut(); navigate('/login') }

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy px-3 py-4 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="px-2"><Logo light /></div>
        <p className="mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/50">{org ?? ROLE_LABEL[profile?.role]}</p>
        <nav aria-label="Dashboard" className="mt-2 space-y-1">
          {items.map(([to, label, Icon]) => <NavLink key={to} to={to} end className={cls}><Icon className="size-4" aria-hidden />{label}</NavLink>)}
        </nav>
        <div className="mt-auto space-y-3 px-2">
          <Link to="/assistant" className="flex items-center gap-2 rounded-lg bg-teal/15 px-3 py-2 text-sm font-medium text-white hover:bg-teal/25"><MessageCircle className="size-4 text-teal" aria-hidden />Tourist assistant</Link>
          <ConnectionIndicator light />
          <p className="text-[11px] leading-snug text-white/50">Demo data. All people, hotels and companies are fictional.</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-[450] border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="lg:hidden"><Logo compact /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{profile?.full_name ?? '…'}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted"><ShieldCheck className="size-3" aria-hidden />{ROLE_LABEL[profile?.role]}{org ? ` · ${org}` : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <button onClick={out} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-navy hover:bg-slate-100"><LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">Sign out</span></button>
            </div>
          </div>
          {items.length > 1 && (
            <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:hidden">
              {items.map(([to, label, Icon]) => (
                <NavLink key={to} to={to} end className={({ isActive }) => `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${isActive ? 'bg-navy text-white' : 'text-muted hover:bg-slate-100'}`}>
                  <Icon className="size-3.5" aria-hidden />{label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6"><Outlet /></main>
      </div>
    </div>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export const PublicPage = ({ children, narrow = false }) => (
  <div className="min-h-dvh pb-24">
    <PublicHeader />
    <main className={`mx-auto px-4 py-6 ${narrow ? 'max-w-2xl' : 'max-w-7xl'}`}>{children}</main>
  </div>
)

