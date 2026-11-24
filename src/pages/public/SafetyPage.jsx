import { Link } from 'react-router-dom'
import { Building2, CreditCard, Phone, Plane, ShieldAlert, UserX, Ban, Siren } from 'lucide-react'
import { select } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { EmergencyNumbers, SomethingWrongButton } from '../../components/tourist/TripBits'

const SECTIONS = [
  [Plane, 'At the airport', [
    'Use only the designated transport pickup areas outside Arrivals. Your booking shows exactly where.',
    'Ignore anyone who approaches you inside the terminal offering a lift or saying they are “from your hotel”.',
    'If you are unsure, stay inside the terminal, where it is busy and staffed, and message your hotel.',
  ]],
  [UserX, 'Avoiding driver impersonation', [
    'Scammers may hold a sign with your name. They can find names on luggage tags or overhear them, so a sign proves nothing.',
    'Check the registration plate, make and colour against your booking before you approach the car.',
    'Ask the driver to say your verification code. Never say it first, and never show it on your phone.',
    'If the code is wrong or missing, do not get in, even if everything else looks right.',
  ]],
  [CreditCard, 'Payment safety', [
    'Your price and payment method are agreed before pickup. You should not need to pay the driver anything.',
    'Don’t hand over your card, and avoid paying in cash unless your booking says so.',
    'Watch out for “airport fees”, “parking fees” or “luggage fees” requested in cash. They are not part of your booking.',
  ]],
  [Ban, 'If a driver asks for extra payment', [
    'Politely refuse and say the price was agreed with your hotel.',
    'Don’t argue if you feel unsafe. Move to a public area and tap “Something’s wrong”.',
    'Your hotel is alerted and can speak to the provider. Keep receipts or messages as evidence.',
  ]],
  [ShieldAlert, 'If a driver refuses to follow the booking', [
    'You can ask the driver to stop in a safe, busy place and get out.',
    'Report it straight away. The hotel and the provider’s safety team are notified.',
    'If you feel threatened, call 10111 (police) or 112 from a mobile.',
  ]],
]

export default function SafetyPage() {
  const { data: hotels } = useLive(async () => (await select('hotels', 'name')).filter((h) => h.status === 'active'), [])
  return (
    <PublicPage narrow>
      <h1 className="text-2xl font-semibold tracking-tight">Tourist safety information</h1>
      <p className="mt-1 text-sm text-muted">Simple steps that stop most transport scams before you get into a vehicle.</p>

      <section className="mt-6 rounded-2xl border border-alert/30 bg-alert/5 p-4" aria-labelledby="em-h">
        <h2 id="em-h" className="mb-3 flex items-center gap-2 font-semibold text-alert-ink"><Siren className="size-5" aria-hidden />Emergency contacts (South Africa)</h2>
        <EmergencyNumbers />
        <p className="mt-2 text-xs text-muted">Tap to call. This service does not contact emergency services for you.</p>
      </section>

      <div className="mt-6 space-y-4">
        {SECTIONS.map(([Icon, title, items]) => (
          <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Icon className="size-5 text-teal-ink" aria-hidden />{title}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">{items.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        ))}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Building2 className="size-5 text-teal-ink" aria-hidden />Partner hotel contacts</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {hotels?.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                <span><strong>{h.name}</strong><span className="block text-xs text-muted">{h.area}</span></span>
                {h.phone && <a className="inline-flex items-center gap-1 font-medium text-teal-ink" href={`tel:${h.phone.replace(/\s/g, '')}`}><Phone className="size-4" aria-hidden />{h.phone}</a>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Fictional demo hotels.</p>
        </section>
        <SomethingWrongButton />
        <p className="text-center text-sm"><Link to="/assistant" className="font-medium text-teal-ink underline">Arrange trusted transport</Link></p>
      </div>
    </PublicPage>
  )
}
