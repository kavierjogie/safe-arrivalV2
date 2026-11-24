import { Link } from 'react-router-dom'
import { Building2, Car, Database, IdCard, Lock, MessageCircle, ShieldCheck, User } from 'lucide-react'
import { PublicPage } from '../../components/layout/Layouts'
import { Button } from '../../components/common/ui'

const ROLES = [
  [User, 'Tourist', ['Opens the hotel’s WhatsApp link or QR code. No app, no account.', 'Chooses pickup, arrival time, group size and a transport option with a visible price.', 'Receives driver details and a one-time code; the driver says it first.', 'Taps “Something’s wrong” at any point and follows the report’s progress.']],
  [Building2, 'Hotel', ['Sees incoming requests and confirms them (or declines with a reason).', 'Sets agreed prices and chooses the provider.', 'Assigns an approved driver; the code is generated and sent straight to the tourist and driver.', 'Acknowledges, follows up and escalates incidents, and records an external SAPS reference if the guest provides one.']],
  [Car, 'Transport provider', ['Accepts or declines shuttle requests sent by partner hotels.', 'Manages its drivers and vehicles. New drivers stay pending until the safety team approves them.', 'Receives incident notifications and escalations for its trips.']],
  [IdCard, 'Driver', ['Sees only assigned trips and the details needed to complete them.', 'Receives the code on their own channel, never on a public screen.', 'Can’t start a ride until the guest has verified them.']],
  [ShieldCheck, 'Safety team (admin)', ['Approves or suspends hotels, providers and drivers.', 'Investigates incidents, assigns handlers and keeps internal notes.', 'Sees patterns across all reports to inform tourism safety work.']],
]

export default function HowItWorksPage() {
  return (
    <PublicPage narrow>
      <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-2 text-slate-600">One trusted verification process across hotel vehicles, partnered shuttles and supported e-hailing. Here’s what each person does.</p>
      <div className="mt-6 space-y-4">
        {ROLES.map(([Icon, title, items]) => (
          <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Icon className="size-5 text-teal-ink" aria-hidden />{title}</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">{items.map((t) => <li key={t}>{t}</li>)}</ol>
          </section>
        ))}
        <section className="rounded-2xl bg-navy p-5 text-white">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Lock className="size-5 text-teal" aria-hidden />Under the hood</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-white/85">
            <li className="flex gap-2"><Database className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden />Supabase Postgres with Row Level Security: each role sees only its own rows, and every change goes through validated server-side functions.</li>
            <li className="flex gap-2"><Lock className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden />Codes are stored as SHA-256 hashes, used once and removed from message history once they stop being valid.</li>
            <li className="flex gap-2"><MessageCircle className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden />One conversation engine powers both the WhatsApp Business webhook and the in-browser simulator.</li>
          </ul>
        </section>
        <div className="flex flex-wrap gap-2">
          <Button as={Link} to="/assistant?hotel=hotel-001">Try the tourist assistant</Button>
          <Button as={Link} to="/login" variant="outline">Partner dashboards</Button>
        </div>
      </div>
    </PublicPage>
  )
}
