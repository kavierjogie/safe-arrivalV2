# Deploying SafeArrival

SafeArrival runs as three pieces. All of them work on free tiers.

| Piece | Where | Current deployment |
|---|---|---|
| Database, auth, storage, Edge Function | Supabase | project `safearrival` (eu-central-1) |
| Web app (React SPA) | Vercel project `safearrival`, repo root | https://safearrival-one.vercel.app |
| MCP server | Vercel project `safearrival-mcp`, root `mcp-server/` | https://safearrival-mcp.vercel.app/mcp |

Without the Supabase environment variables, the web app runs entirely in the browser on PGlite. That mode suits local
development and offline demos.

## 1. Supabase

1. Create a project. The free tier is enough.
2. Apply the migrations **in order** with the SQL editor or `supabase link && supabase db push`:

   | File | Adds |
   |---|---|
   | `…01_schema` | Tables, constraints, indexes |
   | `…02_security` | Role helpers, RLS on every table, grants, Realtime |
   | `…03_rpc` | Every write as a validated, role-checked RPC |
   | `…04_demo_seed` | `private.seed_demo_data()` and `reset_demo()` |
   | `…05_storage` | Private evidence bucket, driver-photo bucket |
   | `…06_mcp` | Incident verification and approximate location; `mcp_call`; emergency numbers and advice |
   | `…07_alerts` | Alert subscriptions, the alert trigger, self-service RPCs, dynamic MCP dispatch |
   | `…08_ai_admin` | `admin_ai_overview()`, `set_mcp_dataset()` |
   | `…09_hardening` | Pinned `search_path`; trigger functions not callable |
   | `…10_anon_revoke` | Staff RPCs not callable by anonymous users |

3. Demo data (optional): run `supabase/seed.sql`. It creates 8 demo staff logins (password in that file) and the
   fictional data.
4. Register the MCP server secret. Use **at least 32 random characters**. Only its SHA-256 hash is stored.
   ```sql
   select private.set_mcp_secret('<MCP_SERVER_SECRET>');
   ```
5. Optional WhatsApp: see the root README ("WhatsApp integration" and "Safety-alert WhatsApp delivery").

## 2. Web app (Vercel)

Import the repository with Vite auto-detected (build `npm run build`, output `dist`). `vercel.json` handles SPA deep links
such as `/alerts/<token>` and `/developers/tools`, and sets security headers.

| Variable | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | Public |
| `VITE_SUPABASE_ANON_KEY` | Publishable / anon key | Public by design. **Never** the service-role key |
| `VITE_WHATSAPP_NUMBER` | Digits only, optional | QR codes open WhatsApp |
| `VITE_MCP_URL` | Optional | Defaults to `https://safearrival-mcp.vercel.app/mcp` (developer portal, admin status) |

`VITE_` variables are compiled into the bundle, so redeploy after changing them. Pushes to `main` deploy production;
other branches get preview URLs, which are protected by Vercel Authentication.

## 3. MCP server (Vercel)

Create a second Vercel project from the same repository with **root directory `mcp-server`** and no framework preset.
`mcp-server/vercel.json` maps `/mcp` and `/health` and pins functions to `fra1` (next to the database).

| Variable | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | Same as above | |
| `SUPABASE_ANON_KEY` | Publishable / anon key | The server never uses the service-role key |
| `MCP_SERVER_SECRET` | The value registered in step 1.4 | Mark **Sensitive** |

- **Deployment protection must be off** for this project. Claude and ChatGPT connect from their own clouds and can't
  pass Vercel Authentication.
- The server is stateless (MCP 2026-07-28, plus a stateless fallback for 2025-era clients), so ordinary serverless
  functions are enough. No long-lived connections are needed.

## 4. Verify a deployment

```bash
curl -s https://safearrival-mcp.vercel.app/health          # {"ok":true,"database":"reachable",...}
cd mcp-server && npm install
node test/smoke.mjs  https://safearrival-mcp.vercel.app/mcp  # read-only, both protocol eras
node test/parity.mjs https://safearrival-mcp.vercel.app/mcp  # deployed tools == local src/server.js
```
Then on the website check:
- `/developers/tools` lists 15 tools.
- `/admin/ai` (as an admin) shows "Online · database reachable".
- An alert manage link from `subscribe_safety_alerts` opens.

Before any deploy, run all automated tests:
```bash
npm test                    # SQL, RLS, conversation engine, MCP tools, alerts, admin (PGlite, no network)
cd mcp-server && npm test   # MCP protocol (both eras) + skill/docs sync
```

## 5. Rolling back

- **Web or MCP server:** in Vercel → Deployments, promote the previous production deployment (instant).
- **Database:** migrations are additive. To roll back data, restore a Supabase backup; the free tier keeps daily
  backups for 7 days.
- **Turn a dataset off for AI clients without a deploy:** Admin → AI integrations → Datasets, or
  `select public.set_mcp_dataset('incident_reports', false);` as an admin.

## 6. Before real data (not done in the hackathon deployment)

- [ ] `update app_settings set value = 'false' where key = 'demo_mode';`. This disables `reset_demo` and removes the
      DEMO DATA notice. Then delete the demo users (`f0000000-…`) and the demo records.
- [ ] Rotate `MCP_SERVER_SECRET`: register a new hash, update Vercel, redeploy.
- [ ] Turn on leaked-password protection (Supabase → Auth).
- [ ] Add a server-side pepper to verification-code hashes.
- [ ] Re-verify every emergency number in `emergency_contacts` against official sources.
- [ ] Complete a POPIA assessment, including the WhatsApp opt-in wording and data retention for reports and
      subscriptions.
- [ ] WhatsApp: an approved alert template, Database Webhooks, then `whatsapp_alerts_enabled = true`. Test it live.
- [ ] Consider OAuth and per-partner API keys on the MCP server if you need higher rate limits or partner-only tools.
