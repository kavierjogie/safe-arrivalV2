// One client for both backends. Every write is an RPC (validated server-side);
// reads are plain selects filtered by Row Level Security.
//   Supabase mode — supabase-js with the anon key + the signed-in user's JWT.
//   Demo mode     — the same SQL on in-browser Postgres (PGlite), run as the
//                   selected demo user, so RLS behaves exactly as in production.
import { supabase, isSupabaseConfigured } from '../lib/supabase'

export const backend = isSupabaseConfigured ? 'supabase' : 'local'
const local = () => import('../lib/localdb')

let localUid = null
export const setLocalUser = (uid) => { localUid = uid }

// ---- change notifications (drives every live view) ------------------------
const listeners = new Set()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('safe-arrival-db') : null
const fire = () => listeners.forEach((f) => f())
if (channel) channel.onmessage = fire
const emit = () => { fire(); channel?.postMessage('change') }
export function onChange(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

if (isSupabaseConfigured) {
  let t
  supabase.channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => { clearTimeout(t); t = setTimeout(fire, 150) })
    .subscribe()
}

export class ApiError extends Error {}
const clean = (e) => new ApiError((e?.message ?? String(e)).replace(/^ERROR:\s*/, '').replace(/^(invalid|not_found|disabled):/, ''))

// Reads must be listed here: any other RPC is treated as a write and triggers a refresh of every
// live view, so a read missing from this list would make useLive() re-request it forever.
const READ_ONLY = new Set(['get_trip', 'get_incident', 'get_alert_subscription', 'admin_ai_overview'])
const toParam = (v) => (Array.isArray(v) ? `{${v.join(',')}}` : v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
const normalise = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))

export async function rpc(fn, args = {}, { as } = {}) {
  if (!/^[a-z_]+$/.test(fn)) throw new ApiError('Bad function name')
  try {
    let result
    if (backend === 'supabase') {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      result = data
    } else {
      const keys = Object.keys(args)
      const rows = await (await local()).runAs(as ?? localUid,
        `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => toParam(args[k])),
        { retry: READ_ONLY.has(fn) })
      result = rows[0].r
    }
    if (!READ_ONLY.has(fn)) emit()
    return result
  } catch (e) {
    throw clean(e)
  }
}

export async function select(table, order = 'created_at desc') {
  if (!/^[a-z_]+$/.test(table)) throw new ApiError('Bad table name')
  try {
    if (backend === 'supabase') {
      let q = supabase.from(table).select('*').limit(2000)
      for (const part of order ? order.split(',') : []) { const [col, dir] = part.trim().split(/\s+/); q = q.order(col, { ascending: dir !== 'desc' }) }
      const { data, error } = await q
      if (error) throw error
      return data
    }
    const rows = await (await local()).runAs(localUid, `select * from public.${table}${order ? ` order by ${order}` : ''} limit 2000`, [], { retry: true })
    return rows.map(normalise)
  } catch (e) {
    throw clean(e)
  }
}

/** Load several tables at once: { table: order|null }. One transaction in demo mode. */
export async function selectMany(spec) {
  const names = Object.keys(spec)
  if (names.some((n) => !/^[a-z_]+$/.test(n))) throw new ApiError('Bad table name')
  if (backend === 'supabase') {
    const rows = await Promise.all(names.map((n) => select(n, spec[n]).catch((e) => { console.error(`Could not load ${n}:`, e.message); return [] })))
    return Object.fromEntries(names.map((n, i) => [n, rows[i]]))
  }
  try {
    const res = await (await local()).runManyAs(localUid, names.map((n) => [`select * from public.${n}${spec[n] ? ` order by ${spec[n]}` : ''} limit 2000`]), { retry: true })
    return Object.fromEntries(names.map((n, i) => [n, res[i].map(normalise)]))
  } catch (e) {
    throw clean(e)
  }
}

// ---- photos (incident evidence, driver photos) ----------------------------
/** Downscale an image in the browser before it leaves the device. */
export async function compressImage(file, max = 1280) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new ApiError('Please choose a JPG, PNG or WebP photo')
  const img = await createImageBitmap(file)
  const s = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * s), height: Math.round(img.height * s) })
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.72))
}

/** Returns a storage path. Demo mode keeps a small data URL instead. */
export async function uploadPhoto(bucket, file) {
  const blob = await compressImage(file, bucket === 'driver-photos' ? 480 : 1280)
  if (backend === 'local') {
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
  }
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw clean(error)
  return path
}

/** Short-lived signed URL for private evidence; public URL for driver photos. */
export async function photoUrl(bucket, path) {
  if (!path || path.startsWith('data:') || backend === 'local') return path
  if (bucket === 'driver-photos') return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}

export async function resetDemo() {
  if (backend === 'local') {
    await rpc('reset_demo', {}, { as: 'f0000000-0000-4000-8000-000000000001' }) // demo admin
  } else {
    await rpc('reset_demo')
  }
  emit()
}
