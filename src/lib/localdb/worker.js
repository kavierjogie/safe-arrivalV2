// Runs the demo database in ONE worker shared by every open tab (leader election
// is handled by PGlite), persisted in IndexedDB.
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { setupStatements } from './setup'

worker({
  async init(options) {
    // relaxedDurability: flush to IndexedDB in the background instead of after every
    // query (~20× faster). First-time setup is flushed explicitly before anyone reads.
    const pg = new PGlite(options.dataDir, { extensions: { pgcrypto }, relaxedDurability: true })
    const hasTables = (await pg.query(`select to_regclass('public.app_settings') is not null as ok`)).rows[0].ok
    const seeded = hasTables && (await pg.query(`select 1 from public.app_settings where key = 'demo_mode'`)).rows.length > 0
    if (!seeded) {
      // A tab closed mid-setup can leave a half-built database: start clean.
      if (hasTables) await pg.exec('drop schema if exists public, app, private, auth cascade; create schema public;')
      for (const sql of setupStatements) await pg.exec(sql)
      await pg.syncToFs(false)
    }
    return pg
  },
})
