import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, BadgeCheck, Banknote, Building2, Car, CheckCircle2, Hotel, KeyRound, MapPinOff, MessageCircle,
  ShieldCheck, Smartphone, UserX, XCircle,
} from 'lucide-react'
import { PublicHeader } from '../../components/layout/Layouts'
import { Button } from '../../components/common/ui'

const PROBLEMS = [
  [UserX, 'Impersonators', 'People posing as your e-hailing or hotel driver, sometimes holding a sign with your name.'],
  [Banknote, 'Surprise prices', 'Cash “airport fees” and inflated fares demanded once your bags are in the car.'],
  [Car, 'Unverified vehicles', 'No way to check a driver or vehicle before you get in.'],
  [MapPinOff, 'Confusing pickups', 'Tired visitors without a local SIM, unsure where to meet their real driver.'],
  [AlertTriangle, 'Nowhere to report', 'Reports go nowhere, and nobody tells you what happened next.'],
]

function PhoneMock() {
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[2rem] bg-navy p-2 shadow-2xl ring-1 ring-white/10" aria-hidden>
      <div className="overflow-hidden rounded-[1.6rem] bg-chat">
        <div className="flex items-center gap-2 bg-deep px-3 py-2 text-white">
          <span className="grid size-7 place-items-center rounded-full bg-teal"><ShieldCheck className="size-4" /></span>
          <p className="flex items-center gap-1 text-xs font-semibold">Safe Arrival CPT <BadgeCheck className="size-3.5 text-teal" /></p>
        </div>
        <div className="chat-pattern space-y-2 p-3 text-[12px] leading-snug text-navy">
          <div className="max-w-[90%] rounded-lg rounded-tl-none bg-white p-2 shadow-sm">
            <p className="font-semibold">YOUR DRIVER HAS BEEN ASSIGNED</p>
            <p className="mt-1">Driver: Michael Daniels<br />Vehicle: White Toyota Corolla<br />Registration: <strong>CA 123-456</strong><br />Provider: Saltwater Lodge Transfers</p>
            <p className="mt-1">Pickup: International Arrivals, designated transport area</p>
            <p className="mt-1.5 rounded bg-navy px-2 py-1 text-center font-mono text-sm font-bold tracking-wide text-white">BLUE TABLE 47</p>
            <p className="mt-1 font-semibold text-alert-ink">Your driver must say this code FIRST.</p>
          </div>
          <div className="ml-auto w-fit rounded-lg rounded-tr-none bg-bubble-out px-2 py-1.5 shadow-sm">✅ Code matches</div>
          <div className="max-w-[90%] rounded-lg rounded-tl-none bg-white p-2 shadow-sm">Driver verified ✅ Your ride has started. Enjoy Cape Town!</div>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="pb-24">
      <PublicHeader />
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-[1.15fr_1fr] lg:py-20">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-teal"><Smartphone className="size-3.5" aria-hidden />WhatsApp-first · no app to download</p>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Know who’s picking you up.<br /><span className="text-teal">Before</span> you get in.</h1>
            <p className="mt-4 max-w-xl text-lg text-white/80">Trusted airport transport for Cape Town visitors, arranged through your hotel. Know who is collecting you, know what you should pay, and know who to contact if something goes wrong.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button as={Link} to="/start?hotel=hotel-001" size="lg"><MessageCircle className="size-5" aria-hidden />Arrange Trusted Transport</Button>
              <Button as={Link} to="/how-it-works" size="lg" variant="outline" className="!bg-transparent !text-white !ring-white/30 hover:!bg-white/10">How it works<ArrowRight className="size-4" aria-hidden /></Button>
            </div>
            <p className="mt-4 text-xs text-white/60">Not another ride-hailing app: a trusted coordination and verification layer between tourists, hotels and transport providers.</p>
          </div>
          <PhoneMock />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14" aria-labelledby="problem-h">
        <h2 id="problem-h" className="text-2xl font-semibold tracking-tight">The problem at the arrivals door</h2>
        <p className="mt-1 max-w-2xl text-muted">International visitors often land without a local SIM, unsure of local transport and tired after a long flight. That makes them easy targets.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PROBLEMS.map(([Icon, t, d]) => (
            <div key={t} className="rounded-2xl border border-slate-200 bg-white p-4">
              <Icon className="size-6 text-alert" aria-hidden />
              <p className="mt-2 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-14" aria-labelledby="how-h">
        <div className="mx-auto max-w-7xl px-4">
          <h2 id="how-h" className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-4">
            {[
              ['Scan or tap', 'Your hotel sends a WhatsApp link with your booking, or you scan its QR code.'],
              ['Book with a clear price', 'Pick one of your hotel’s approved options. You see the agreed price, or a clearly labelled estimate, before you confirm.'],
              ['Get your driver', 'The hotel assigns an approved driver. You receive their photo, vehicle, registration and a one-time code.'],
              ['Verify, then ride', 'The driver says your code first. If anything doesn’t match, don’t get in. Tap “Something’s wrong”.'],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-2xl bg-canvas p-5">
                <span className="grid size-8 place-items-center rounded-full bg-teal font-bold text-white">{i + 1}</span>
                <p className="mt-3 font-semibold">{t}</p>
                <p className="mt-1 text-sm text-slate-600">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-14 lg:grid-cols-2" aria-labelledby="verify-h">
        <div className="rounded-3xl bg-navy p-6 text-white">
          <h2 id="verify-h" className="flex items-center gap-2 text-xl font-semibold"><KeyRound className="size-5 text-teal" aria-hidden />How driver verification works</h2>
          <div className="mt-5 space-y-3">
            <div className="max-w-[85%] rounded-2xl rounded-tl-none bg-white/10 p-3"><p className="text-xs text-white/60">Driver</p><p className="font-semibold">“Hi Sarah. Your code is <span className="font-mono text-teal">BLUE TABLE 47</span>.”</p></div>
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-none bg-teal p-3 text-navy"><p className="text-xs">Sarah checks her WhatsApp</p><p className="font-semibold">It matches ✅ Registration matches ✅</p></div>
          </div>
          <ul className="mt-5 space-y-2 text-sm text-white/85">
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden />The driver must say the code first. The tourist never reads it out.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden />Unique per booking, random, single-use, and expires after pickup.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden />Stored only as a hash. Hotel dashboards never see it.</li>
            <li className="flex gap-2"><XCircle className="mt-0.5 size-4 shrink-0 text-alert" aria-hidden />Wrong code? Don’t get in. One tap alerts the hotel and the provider.</li>
          </ul>
        </div>
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Hotel className="size-5 text-teal-ink" aria-hidden />Why hotels are involved</h2>
            <p className="mt-2 text-sm text-slate-700">Tourists already trust the hotel they booked. Hotels choose the transport partners, set or approve the price, assign approved drivers and are the first to hear when something goes wrong. That makes the arrangement accountable before the tourist lands.</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Building2 className="size-5 text-teal-ink" aria-hidden />One verification across every provider</h2>
            <p className="mt-2 text-sm text-slate-700">Hotel vehicles, partnered shuttles and supported e-hailing arrangements all use the same driver card and the same one-time code. Tourists don’t need to learn how each provider works.</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              {['Hotel fleet', 'Partnered shuttles', 'Uber Central (integration-ready, simulated)'].map((t) => <span key={t} className="rounded-full bg-canvas px-3 py-1">{t}</span>)}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="size-5 text-teal-ink" aria-hidden />Why tourists can trust it</h2>
            <p className="mt-2 text-sm text-slate-700">Only approved drivers from approved partners can be assigned. Every report gets an internal reference and a timeline you can follow. We never collect passport or card details, and we never pretend to issue police case numbers.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-teal p-6 text-navy">
          <div><p className="text-xl font-semibold">Landing soon? Arrange trusted transport now.</p><p className="text-sm">Takes about a minute. No app, no account.</p></div>
          <div className="flex flex-wrap gap-2">
            <Button as={Link} to="/start?hotel=hotel-001" variant="dark" size="lg">Arrange Trusted Transport</Button>
            <Button as={Link} to="/login" variant="outline" size="lg">Partner sign in</Button>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-muted">Hackathon prototype. All hotels, drivers, providers and incidents are fictional demo data. WhatsApp and Uber Central integrations are simulated unless configured.</p>
      </section>
    </div>
  )
}
