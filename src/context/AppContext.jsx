import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { backend, onChange, rpc, select, selectMany, setLocalUser } from '../services/api'
import { DEMO_ACCOUNTS } from '../config/demoAccounts'

const SESSION_KEY = 'sa-demo-session'
const AppContext = createContext(null)

export const ROLE_HOME = { admin: '/admin', hotel_staff: '/hotel', provider_staff: '/provider', driver: '/driver', tourist: '/my-bookings' }

export function AppProvider({ children }) {
  const [uid, setUid] = useState(undefined) // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null)
  const [dbReady, setDbReady] = useState(backend === 'supabase')

  // Demo mode: warm up the in-browser database while the landing page renders.
  useEffect(() => {
    if (backend !== 'local') return
    import('../lib/localdb').then((m) => m.localDb()).then(() => setDbReady(true))
      .catch((e) => toast.error(`Demo database failed to start: ${e.message}`))
  }, [])

  // Session: per-tab in demo mode, so one tab can be the hotel and another the admin.
  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null))
      const { data } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user.id ?? null))
      return () => data.subscription.unsubscribe()
    }
    const saved = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY)
    setLocalUser(saved || null)
    setUid(saved || null)
  }, [])

  useEffect(() => {
    if (uid === undefined || !dbReady) return
    if (!uid) { setProfile(null); return }
    let live = true
    let timer
    // Retry rather than downgrading the user if the database is briefly unavailable.
    const load = (attempt = 1) => select('profiles', null)
      .then((rows) => live && setProfile(rows.find((r) => r.id === uid) ?? { id: uid, role: 'tourist' }))
      .catch((e) => {
        if (!live) return
        if (attempt < 5) timer = setTimeout(() => load(attempt + 1), 1000 * attempt)
        else toast.error(`Could not load your account: ${e.message}`)
      })
    load()
    return () => { live = false; clearTimeout(timer) }
  }, [uid, dbReady])

  const signIn = useCallback(async (email, password) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return
    }
    const acct = DEMO_ACCOUNTS.find((a) => a.email === email)
    if (!acct) throw new Error('Unknown demo account')
    sessionStorage.setItem(SESSION_KEY, acct.id)
    localStorage.setItem(SESSION_KEY, acct.id)
    setLocalUser(acct.id)
    setProfile(null)
    setUid(acct.id)
  }, [])

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut()
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSION_KEY)
    setLocalUser(null)
    setProfile(null)
    setUid(null)
  }, [])

  /** RPC with a toast on failure. Returns undefined if it failed. */
  const act = useCallback(async (fn, args, success) => {
    try {
      const r = await rpc(fn, args)
      if (success) toast.success(success)
      return r ?? true
    } catch (e) {
      toast.error(e.message)
      return undefined
    }
  }, [])

  const value = useMemo(() => ({
    uid, profile, role: profile?.role ?? (uid ? null : 'anon'), loadingSession: uid === undefined || (uid && !profile),
    dbReady, signIn, signOut, act,
  }), [uid, profile, dbReady, signIn, signOut, act])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => useContext(AppContext)

/**
 * Runs `load` now and again whenever the data changes (any tab, or Supabase
 * Realtime). `poll` (ms) adds polling — used for anonymous tourist views in
 * Supabase mode, where Realtime can't see rows hidden by RLS.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useLive(load, deps, { poll, enabled = true } = {}) {
  const { dbReady, uid } = useApp()
  const [state, setState] = useState({ data: undefined, error: null, loading: true })
  const loadRef = useRef(load)
  useLayoutEffect(() => { loadRef.current = load })
  const run = useCallback(() => {
    let live = true
    loadRef.current().then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState((s) => ({ data: s.data, error, loading: false })))
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!dbReady || !enabled) return
    let cancel = run()
    const off = onChange(() => { cancel(); cancel = run() })
    const iv = poll && backend === 'supabase' ? setInterval(() => { cancel(); cancel = run() }, poll) : null
    return () => { cancel(); off(); if (iv) clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady, enabled, uid, run, poll, ...deps])
  return { ...state, reload: run }
}

const ORDER = { pickup_points: null, provider_service_areas: null, app_settings: null, booking_drivers: 'assigned_at desc' }

/** Load several RLS-filtered tables at once: useTables(['bookings', 'hotels']). */
// eslint-disable-next-line react-refresh/only-export-components
export function useTables(names) {
  const key = names.join(',')
  const r = useLive(() => selectMany(Object.fromEntries(names.map((n) => [n, ORDER[n] === undefined ? 'created_at desc' : ORDER[n]]))), [key])
  return { ...(r.data ?? Object.fromEntries(names.map((n) => [n, []]))), loading: r.loading && !r.data, error: r.error }
}
