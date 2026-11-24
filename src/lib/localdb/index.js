// Demo-mode backend: the real Supabase migrations running in-browser on PGlite
// (Postgres compiled to WebAssembly). Same RLS, same RPCs as production.
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { dataDir } from './setup'

let ready
export function localDb() {
  ready ??= connect()
  return ready
}

/**
 * Join (or become) the tab that owns the database. The worker creates and seeds it
 * on first run (see worker.js). Leadership hand-over between tabs during a reload
 * can occasionally stall, so each attempt times out and retries with a fresh worker.
 */
async function connect(attempts = 3) {
  for (let i = 1; ; i++) {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    let timer
    try {
      return await Promise.race([
        PGliteWorker.create(w, { dataDir }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Demo database did not start')), 20000) }),
      ])
    } catch (e) {
      w.terminate()
      if (i >= attempts) { ready = undefined; throw e }
    } finally {
      clearTimeout(timer)
    }
  }
}

// PGliteWorker deadlocks if transactions overlap, so queue them. Postgres here
// is single-connection anyway, so this costs nothing.
let queue = Promise.resolve()
const TIMEOUT_MS = 8000

/** Run SQL as a user (uid) or anonymously — the same way PostgREST applies a JWT. */
export async function runAs(uid, sql, params = [], opts) {
  return (await runManyAs(uid, [[sql, params]], opts))[0]
}

/**
 * Several statements in ONE transaction (far faster for dashboards).
 * If tabs hand over database leadership mid-query, a request can be lost; after
 * a timeout we reconnect, and read-only calls (`retry: true`) are retried once.
 */
export function runManyAs(uid, statements, { retry = false } = {}) {
  const attempt = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ready = undefined; reject(new Error('Demo database did not respond — reconnecting')) }, TIMEOUT_MS)
    run(uid, statements).then(resolve, reject).finally(() => clearTimeout(timer))
  })
  const result = queue.then(attempt).catch((e) => {
    if (retry && e.message.startsWith('Demo database did not respond')) return attempt()
    throw e
  })
  queue = result.catch(() => {})
  return result
}

async function run(uid, statements) {
  const pg = await localDb()
  return pg.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('search_path', 'public, extensions', true)`,
      [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })])
    await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`)
    const out = []
    for (const [sql, params = []] of statements) out.push((await tx.query(sql, params)).rows)
    return out
  })
}
