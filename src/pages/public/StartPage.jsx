import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { BadgeCheck, ClipboardList, Globe, MessageCircle, Plane, ShieldAlert, ShieldCheck } from 'lucide-react'
import { select } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { Button, Spinner } from '../../components/common/ui'
import { WHATSAPP_BUSINESS_NAME, whatsappNumber } from '../../lib/supabase'

/** /s/:code: the short link printed under each hotel's QR code. */
export function ShortLink() {
  const { code } = useParams()
  const { data: hotel, loading } = useLive(async () => (await select('hotels', null)).find((h) => h.short_code === code?.toLowerCase()) ?? null, [code])
  if (loading) return <Spinner />
  return <Navigate to={hotel ? `/start?hotel=${hotel.slug}` : '/start?src=airport'} replace />
}

/** QR landing page. Identifies the referring hotel (or the airport) and teaches the trust check first. */
export default function StartPage() {
  const [params] = useSearchParams()
  const slug = params.get('hotel')
  const { data: hotel, loading } = useLive(async () => (slug ? (await select('hotels', null)).find((h) => h.slug === slug && h.status === 'active') ?? null : null), [slug])
  const q = slug && hotel ? `?hotel=${slug}` : ''
  const waLink = whatsappNumber ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`START ${slug ?? 'airport'}`)}` : null

  if (loading && slug) return <PublicPage narrow><Spinner /></PublicPage>
  return (
    <PublicPage narrow>
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-teal text-white">{hotel ? <ShieldCheck className="size-8" aria-hidden /> : <Plane className="size-8" aria-hidden />}</span>
        <p className="mt-4 text-sm font-medium text-teal-ink">{hotel ? `Welcome, ${hotel.name} guest` : 'Welcome to Cape Town'}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Arrange trusted transport</h1>
        <p className="mx-auto mt-2 max-w-md text-slate-600">Know who is picking you up, know what you should pay, and know who to contact if something goes wrong.</p>
        {slug && !hotel && <p className="mx-auto mt-3 max-w-md rounded-lg bg-amber/15 p-2 text-sm text-amber-ink">This QR code isn’t linked to an active partner hotel. You can still use the service below.</p>}
      </div>

      <section className="mt-6 rounded-2xl border-2 border-teal/40 bg-white p-5" aria-labelledby="trust-h">
        <h2 id="trust-h" className="flex items-center gap-2 font-semibold"><ShieldAlert className="size-5 text-teal-ink" aria-hidden />Check before you share anything</h2>
        <p className="mt-1 text-sm text-slate-600">A QR code on its own doesn’t prove anything: fake stickers exist. Before you share your details, check both of these:</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden /><span>On WhatsApp, the business name is <strong>{WHATSAPP_BUSINESS_NAME}</strong> with the verified badge.</span></li>
          <li className="flex gap-2"><Globe className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden /><span>This page’s address starts with <strong className="font-mono">{location.host}</strong>.</span></li>
        </ul>
        <p className="mt-3 text-xs text-muted">We will never ask for your passport, card number or a password.</p>
      </section>

      <div className="mt-6 grid gap-3">
        {waLink
          ? <Button as="a" href={waLink} size="lg" className="w-full !bg-[#25D366] !text-navy"><MessageCircle className="size-5" aria-hidden />Continue on WhatsApp</Button>
          : <Button as={Link} to={`/assistant${q}`} size="lg" className="w-full"><MessageCircle className="size-5" aria-hidden />Open the WhatsApp assistant (simulated)</Button>}
        <Button as={Link} to={`/book${q}`} variant="outline" size="lg" className="w-full"><ClipboardList className="size-5" aria-hidden />Book with a form instead</Button>
        <Link to="/report" className="text-center text-sm font-medium text-alert-ink underline">Something’s already wrong? Report it</Link>
      </div>
    </PublicPage>
  )
}
