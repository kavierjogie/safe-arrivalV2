// Shared test setup: the real migrations + seed on PGlite, and helpers to act as a role.
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

process.on('unhandledRejection', (e) => { console.error('✗', e.message, e.where ?? ''); process.exit(1) })

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
export const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(read('src/lib/localdb/bootstrap.sql'))
for (const f of readdirSync(new URL('supabase/migrations/', root)).sort()) await db.exec(read(`supabase/migrations/${f}`))
await db.exec(read('supabase/seed.sql'))

export const U = { admin: 'f0000000-0000-4000-8000-000000000001', hotel1: 'f0000000-0000-4000-8000-000000000002', hotel2: 'f0000000-0000-4000-8000-000000000003',
  shuttle: 'f0000000-0000-4000-8000-000000000004', michael: 'f0000000-0000-4000-8000-000000000005' }

/** Run a query as a given user (null = anonymous tourist), exactly as PostgREST would. */
export async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('search_path', 'public, extensions', true)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })])
    await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`)
    return (await tx.query(sql, params)).rows
  })
}
export const rpc = async (uid, fn, args = {}) => {
  const keys = Object.keys(args)
  const rows = await as(uid, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, Object.values(args))
  return rows[0].r
}
