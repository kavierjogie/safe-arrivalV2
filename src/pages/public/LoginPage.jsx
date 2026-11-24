import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2, Car, IdCard, KeyRound, ShieldCheck } from 'lucide-react'
import { ROLE_HOME, useApp } from '../../context/AppContext'
import { isSupabaseConfigured } from '../../lib/supabase'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_LABEL } from '../../config/demoAccounts'
import { PublicPage } from '../../components/layout/Layouts'
import { Button, Field, inputCls } from '../../components/common/ui'

const ICON = { admin: ShieldCheck, hotel_staff: Building2, provider_staff: Car, driver: IdCard }

export default function LoginPage() {
  const { signIn, uid, profile } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [justSignedIn, setJustSignedIn] = useState(false)

  // Redirect only after signing in here, so a signed-in user can still switch accounts.
  useEffect(() => {
    if (justSignedIn && uid && profile) navigate(params.get('next') ?? ROLE_HOME[profile.role] ?? '/', { replace: true })
  }, [justSignedIn, uid, profile, navigate, params])

  const go = async (e, pw = password, em = email) => {
    e?.preventDefault()
    setBusy(true)
    try { await signIn(em, pw); setJustSignedIn(true) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  return (
    <PublicPage narrow>
      <h1 className="text-2xl font-semibold tracking-tight">Partner sign in</h1>
      <p className="mt-1 text-sm text-muted">For hotels, transport providers, drivers and the safety team. Tourists don’t need an account.</p>
      {uid && profile && !justSignedIn && (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-teal/10 px-3 py-2 text-sm">
          Signed in as <strong>{profile.full_name ?? profile.email}</strong>.
          <Link to={ROLE_HOME[profile.role] ?? '/'} className="font-medium text-teal-ink underline">Go to your dashboard</Link>
          <span className="text-muted">or choose another account below.</span>
        </p>
      )}

      {isSupabaseConfigured && (
        <form onSubmit={go} className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <Field label="Email"><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
          <Field label="Password"><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
          <Button type="submit" className="w-full" disabled={busy}><KeyRound className="size-4" aria-hidden />Sign in</Button>
        </form>
      )}

      <section className="mt-6" aria-labelledby="demo-h">
        <h2 id="demo-h" className="text-sm font-semibold">Demo accounts</h2>
        <p className="text-xs text-muted">{isSupabaseConfigured ? `Seeded users. Password: ${DEMO_PASSWORD} (demo only).` : 'Demo mode: choose an account; no password needed. Each browser tab can be a different account.'}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((a) => {
            const Icon = ICON[a.role]
            return (
              <button key={a.id} disabled={busy} onClick={() => go(null, DEMO_PASSWORD, a.email)}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-teal hover:bg-teal/5 disabled:opacity-50">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy text-white"><Icon className="size-4" aria-hidden /></span>
                <span className="min-w-0"><span className="block font-semibold">{a.name}</span><span className="block text-xs text-muted">{ROLE_LABEL[a.role]} · {a.org}</span></span>
              </button>
            )
          })}
        </div>
      </section>
    </PublicPage>
  )
}
