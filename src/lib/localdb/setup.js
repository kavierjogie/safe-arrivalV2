// Everything that builds the demo database: a Supabase stand-in, the real
// migrations (in order) and the real seed file.
import bootstrap from './bootstrap.sql?raw'
import seed from '../../../supabase/seed.sql?raw'

const migrations = Object.entries(import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b)).map(([, sql]) => sql)

export const setupStatements = [bootstrap, ...migrations, seed]

// Any change to the SQL gives a fresh database name, so stale demo data never meets a new schema.
const hash = setupStatements.join('\n').split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)
export const dataDir = `idb://safe-arrival-${(hash >>> 0).toString(36)}`
