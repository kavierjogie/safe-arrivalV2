# Safe Arrival CPT

**Know who is picking you up, know what you should pay, and know who to contact if something goes wrong.**

A WhatsApp-first trusted transport and safety platform for tourists arriving in Cape Town, built for the Cape Town Tourism *Safer and Smarter Tourism* hackathon. It is **not another Uber**. It is a coordination and verification layer between tourists, partner hotels, shuttle companies and supported e-hailing, built around **one verification process that works the same across every provider**.

Its safety information is also available **inside the AI assistants tourists already use**. ChatGPT, Claude and any MCP client can connect to the public SafeArrival MCP server to check reported transport incidents, verify a driver or partner, get pickup guidance and emergency numbers, report a problem, or subscribe to alerts. See [SafeArrival MCP](#safearrival-mcp-safety-tools-inside-ai-assistants), the [demo script](docs/DEMO.md) and [deployment](docs/DEPLOYMENT.md).

> **Prototype notice.** All hotels, providers, drivers, tourists and incidents are fictional, and every MCP response says so. The live site uses one shared Supabase demo database. WhatsApp and Uber Central are simulated unless you configure them (see below). Meeting-point descriptions are demo content.

---

## Try it in 3 minutes

```bash
npm install
npm run dev        # http://localhost:5173
```

No accounts, keys or backend needed. In demo mode the app runs **the real Supabase migrations, Row Level Security and RPC functions in your browser** on [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly). It's shared across tabs and persisted in IndexedDB.

Open the **Guided demo** in the presenter bar at the bottom of every page:

**Scenario 1: verified pickup**
1. **Tourist** → *Send "Hi"* → *Arrange transport* → International Arrivals → Tomorrow → 14:30 → 2 passengers → 2 bags → *Saltwater Lodge Transfers* (R450 agreed price) → *Confirm booking*.
2. **Hotel** (Fatima, in a second window) → the request appears live → open it → *Confirm booking* → assign **Michael Daniels** + **CA 123-456**.
3. **Tourist** → the driver message arrives in the chat with name, vehicle, registration and a code like `BLUE TABLE 47`. *Open booking page* shows the photo, map and code card.
4. **Driver** (Michael) → *I'm on my way* → *I've arrived*. He **cannot** start the ride himself.
5. **Tourist** → *Verify my driver* → type what the driver says, or tap *✅ Code matches* → ride in progress. The code is now spent and removed from the message history.

**Scenario 2: impostor refused**
1. Make another booking; use the shortcut *Hotel: confirm + assign Michael*.
2. **Tourist** → *Verify my driver* → *Other problem* → **Wrong vehicle** → "Do not enter the vehicle" → describe → *No, I am safe* → reference **SAFE-2026-00xx** at once.
3. **Hotel** → toast and incident → *Acknowledge* → the update reaches the tourist's WhatsApp and the tracking page live.
4. **Admin** → *Incidents* (assign handler, record an external SAPS number) → *Overview* shows **"3 complaints involving unexpected additional payment requests were reported at … International Arrivals"**.

*Reset* restores the seed data at any time.

## What's built

| Area | Routes | Highlights |
|---|---|---|
| Public | `/` `/how-it-works` `/safety` | Landing, role walkthrough, tourist safety info with SA emergency numbers |
| QR onboarding | `/start?hotel=hotel-001` `/start?src=airport` `/s/:code` | Identifies the hotel; teaches the trust check (verified WhatsApp name + web address) before any data is shared |
| WhatsApp assistant | `/assistant` | Simulated chat driven by the **same engine as the production webhook**: lists, reply buttons, free-text parsing, backend push messages appear in the chat |
| Booking | `/book` | Form alternative; options show agreed vs estimate vs provider-confirmed price, capacity, payment arrangement |
| Trip | `/trip/:token` | Status stepper, driver card + photo, code card with the "driver says it FIRST" rule, typed-code check, 5 verification outcomes, map + directions, price, contacts, message history, cancel |
| Something's wrong | `/report` `/incident/:token` | 8 categories, description, up to 3 photos, location, urgent flag → immediate internal reference; live timeline with plain-English status explanations; never a fake SAPS number |
| History | `/my-bookings` | Device-remembered links (no account), plus account bookings for signed-in tourists |
| Hotel | `/hotel/*` | Overview stats, live notifications, confirm/decline, set price, change provider, assign drivers, status updates, cancel, incident handling, own-fleet drivers, QR poster (PNG/print), email link text, pricing editor |
| Provider | `/provider/*` | Bookings from partner hotels (accept/decline/assign), drivers & vehicles (new drivers start *pending*), incident alerts, company profile |
| Driver | `/driver` | Assigned trips only, code from their own WhatsApp message, on-the-way/arrived/completed; can't start a ride without guest verification |
| Admin | `/admin/*` | Platform KPIs, safety-intelligence patterns, analytics (types, locations, providers, over time, verification failures, payment complaints), incident investigation, partner approvals, audit log |

## SafeArrival MCP: safety tools inside AI assistants

SafeArrival's safety tools are also available to AI assistants through a public MCP server:

**`https://safearrival-mcp.vercel.app/mcp`** (Streamable HTTP, no sign-in, rate-limited)

The 11 tools cover area and route reports, alerts, transport-provider and driver checks, pickup guidance, emergency numbers, incident reporting and alert subscriptions (monitored by the backend, sent only for incidents the safety team has verified; managed at `/alerts/<token>`). Every result states its verification status, source, timestamps, location precision and limitations. There are no safety scores. Raw traveller descriptions never leave the database.

| | |
|---|---|
| Connect Claude | [docs/integrations/connect-claude.md](docs/integrations/connect-claude.md) |
| Connect ChatGPT (Business/Enterprise/Edu; Pro read-only) | [docs/integrations/connect-chatgpt.md](docs/integrations/connect-chatgpt.md) |
| Cursor, VS Code, Claude Code, Inspector, SDK | [docs/integrations/mcp-clients.md](docs/integrations/mcp-clients.md) |
| Agent Skill | [skills/](skills/README.md) |
| Server code, security model, deploy | [mcp-server/](mcp-server/README.md) |
| Developer portal (live tool reference, try-it console) | [`/developers`](https://safearrival-one.vercel.app/developers) |
| Admin: AI usage, delivery status, dataset switches | `/admin/ai` (safety team) |

The hackathon deployment uses fictional demo data, and every response says so.

## Architecture

```
Tourist ── WhatsApp (Meta Cloud API) ─▶ Edge Function whatsapp-webhook ─┐
   │                                    (signature-verified)             │  same conversation engine
   └── Web (React SPA on Vercel) ─▶ simulated chat ─────────────────────┤  supabase/functions/_shared/conversation.js
                                                                         ▼
Hotel / Provider / Driver / Admin ─▶ supabase-js (anon key + JWT) ─▶ Postgres RPCs (validation, roles, audit)
                                                                    + Row Level Security on every table
                                                                    + Realtime → live dashboards
notifications INSERT ─▶ Database Webhook ─▶ whatsapp-webhook/dispatch ─▶ tourist & driver WhatsApp
```

* **All writes are RPCs** (`supabase/migrations/…003_rpc.sql`). No client role has INSERT/UPDATE/DELETE on any table. Each function checks the caller's role and scope, validates input, enforces status transitions and writes audit entries.
* **Reads go through RLS.** Hotels see only their bookings and incidents, providers only theirs, drivers only assigned trips, tourists only their own (by token, or by account).
* **One backend, two runtimes.** `src/services/api.js` sends the same calls to Supabase or to PGlite. In demo mode, `src/lib/localdb` runs the identical SQL and impersonates users exactly as PostgREST does (`request.jwt.claims` + `set role`), so RLS is genuinely enforced in the demo too.
* **Transport adapters** (`src/services/transport/adapters.js`): `createBooking / getBookingStatus / cancelBooking / assignDriver / sendDriverInstructions` for hotel fleets, shuttles, and an Uber Central mock.

### Verification codes
* Format `WORD WORD NN` (e.g. `BLUE TABLE 47`), drawn with `gen_random_bytes`, **unique for all time** (unique hash index), one active code per booking.
* Stored **only as a SHA-256 hash**. No RLS policy exposes the table to anyone.
* Plaintext exists only in the tourist's and the driver's WhatsApp messages, and is **redacted from them** as soon as the code is used, expires (`app_settings.code_ttl_minutes`, default 180 min after pickup) or is revoked (reassignment or cancellation).
* Staff dashboards never receive the code. `assign_driver` returns only the expiry.
* Tourists can type what the driver *said*; it is checked server-side against the hash (rate-limited: 5 checks per 10 min).
* The tourist's private link token lives in a separate `booking_tokens` table, so staff who can read bookings can never open the tourist's code page.

### Data model
`profiles, hotels, transport_providers, provider_service_areas, hotel_transport_partners, drivers, vehicles, tourists, bookings, booking_tokens, booking_drivers, verification_codes, verification_attempts, incidents, incident_updates, incident_evidence, notifications, audit_logs, whatsapp_sessions, pickup_points, app_settings`, with UUID keys, foreign keys, CHECK constraints on every status, indexes on hot paths and `updated_at` triggers.

## Tech stack
React 19 · JavaScript · Vite · Tailwind CSS v4 · React Router · Lucide · Supabase (Postgres, Auth, RLS, Realtime, Storage, Edge Functions) · PGlite (demo backend) · Leaflet + OpenStreetMap · Recharts · qrcode.react · Vercel

## Tests

```bash
npm test                  # = test:db + test:chat + test:mcp   (no network, no accounts)
cd mcp-server && npm test # MCP protocol tests + skill/docs sync
```
* `scripts/test-db.mjs` runs every migration + seed on real Postgres (PGlite), then checks the RLS boundaries per role, both scenarios, code hashing/redaction/expiry, incidents, police references, admin approvals, audit and reset.
* `scripts/test-conversation.mjs` drives the WhatsApp engine through both scenarios against the SQL, and checks WhatsApp's button and list limits.
* `scripts/test-mcp.mjs` covers:
  * every MCP tool, and server-secret auth
  * rate limits
  * privacy: no raw report text, and a prompt-injection string that never reaches output
  * verification labels and dataset switches
  * alert subscriptions: consent, coverage, verified-only alerts, no duplicates, pause/expiry, data deletion on unsubscribe
  * the admin AI overview
* `mcp-server/test/server.test.mjs` speaks real MCP to the server: a client pinned to 2026-07-28, plus a raw 2025-era request, with validation, CORS and logging.
* `mcp-server/test/docs.test.mjs` fails if the skill, guides, READMEs or developer portal mention a tool that doesn't exist, or leave one out.
* Against a deployment: `node mcp-server/test/smoke.mjs <url>` (read-only) and `node mcp-server/test/parity.mjs <url>` (deployed tools match the code).

`scripts/e2e.py` (Playwright) drives the full UI through both scenarios: four roles, two live tabs, mobile viewport and reset. Run `npm run dev` first.

## Environment variables
See `.env.example`. Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_WHATSAPP_NUMBER` and `VITE_MCP_URL`, go in the frontend. **Never** put the service-role key or WhatsApp secrets in a `VITE_` variable. The MCP server has its own variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MCP_SERVER_SECRET`); see `mcp-server/.env.example`. Every variable for every project is listed in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Supabase setup
1. Create a project (the free tier is fine).
2. Run the SQL in order: `supabase/migrations/20261124000001…10_*.sql`, then `supabase/seed.sql` (SQL editor, or `supabase link && supabase db reset`). If you run the MCP server, register its secret: `select private.set_mcp_secret('<MCP_SERVER_SECRET>');`. Full steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.local` and to Vercel.
4. Demo logins (seeded): `frontdesk@saltwaterlodge.demo`, `admin@safearrival.demo`, `michael@saltwaterlodge.demo`, `dispatch@trustedshuttle.demo`, … password **`SafeArrival-Demo-2026`**. *If your Supabase version rejects the seeded auth users, create them under Authentication → Users with the same emails; the profile rows link by id, so re-run `select private.seed_demo_data();` after setting each new user's id to the one in `seed.sql`, or update `profiles.id`.*
5. New sign-ups become `tourist` profiles. An admin promotes staff by updating `profiles.role` and `hotel_id` / `provider_id` / `driver_id`.
6. Tourist pages poll every 4 s in Supabase mode (anonymous users can't receive RLS-filtered Realtime events). Staff dashboards use Realtime.

## WhatsApp integration (Meta Cloud API)
1. Create a Meta app with the WhatsApp product. Note the **phone number ID**, a **permanent access token**, and the **app secret**.
2. Deploy the function and set secrets:
   ```bash
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   supabase secrets set WHATSAPP_ACCESS_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… WHATSAPP_APP_SECRET=… \
     WHATSAPP_VERIFY_TOKEN=<any random string> DISPATCH_SECRET=<random> PUBLIC_APP_URL=https://<your-vercel-app>
   ```
3. In Meta → Webhooks: callback `https://<project>.supabase.co/functions/v1/whatsapp-webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
4. In Supabase → Database Webhooks: on `notifications` INSERT, POST to `…/whatsapp-webhook/dispatch` with header `Authorization: Bearer <DISPATCH_SECRET>`.
5. Set `VITE_WHATSAPP_NUMBER` so QR codes open `wa.me/<number>?text=START hotel-001`.

The webhook verifies `X-Hub-Signature-256`, ignores Meta's duplicate deliveries (`last_message_id`), rate-limits each number, stores conversation state in `whatsapp_sessions`, and handles unexpected input, keywords (`menu`, `help`/`agent`, `emergency`), returning users and cancellations. **Not yet done:** business-initiated messages outside WhatsApp's 24-hour window need **pre-approved templates**, and a Twilio adapter is not implemented. Neither has been tested against a live Meta account.

**Safety-alert WhatsApp delivery** (optional; without it, alerts appear on the subscriber's `/alerts/<token>` page and are marked "WhatsApp not connected"):
1. In Meta, create a *Utility* template with 3 body variables. For example: `{{1}}: {{2}} Manage or stop these alerts: {{3}}`. Get it approved.
2. Set the template name, and optionally its language (default `en`):
   ```bash
   supabase secrets set WHATSAPP_ALERT_TEMPLATE=<name> WHATSAPP_ALERT_TEMPLATE_LANG=en
   ```
3. Add a second Database Webhook: on `alert_deliveries` INSERT, POST to `…/whatsapp-webhook/dispatch` with the same `Authorization` header.
4. Turn it on in the SQL editor:
   ```sql
   update app_settings set value = 'true' where key = 'whatsapp_alerts_enabled';
   ```
   New WhatsApp alerts then start as `queued`, and the dispatcher marks them `sent`, `failed` or `not_configured`.

This path is implemented but **untested against a live Meta account**.

## Uber Central
Uber options are labelled as **estimates** and run through a **simulated adapter**. Confirming one creates a `SIM-UBER-…` reference flagged `external_simulated`, and every screen says no real Uber trip was requested. Still open: whether Uber Central's trip notes or rider messages can reliably carry the verification code to the driver. This needs confirmed API access and Uber's answer, so it is not claimed.

## Deploying to Vercel
Two Vercel projects deploy from this repo:
* **The web app** (repo root): Vite is auto-detected (`npm run build` → `dist`). `vercel.json` handles SPA deep links, long-term caching for hashed assets, and basic security headers. Without Supabase env vars, the deployed site runs the in-browser demo instead.
* **The MCP server** (root directory `mcp-server`): stateless serverless functions in `fra1`, with deployment protection **off** so AI assistants can reach it.

Env vars, verification, rollback and a pre-production checklist are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Security & privacy
Implemented: Supabase Auth and roles; RLS on every table; RPC-only writes with server-side validation and transition rules; hashed, single-use, expiring codes; private link tokens kept apart from staff-readable data; driver phone shown to the tourist only once the driver is on the way; private evidence bucket with signed URLs scoped to incidents the viewer may see; rate limits on bookings, code checks, verifications and reports; webhook signature verification; audit log of admin and booking actions; no passport, card or payment credential collection; dashboards labelled as demo data.

**MCP and alerts:**
* The MCP server uses no service-role key: the publishable key plus a server secret, whose hash is checked inside Postgres.
* Input is validated twice, by schema in the server and by type and range in SQL.
* Rate limits per salted IP hash, enforced in Postgres.
* Raw traveller descriptions never reach AI output, which closes that path for prompt injection.
* Results carry verification labels and limitations, never safety scores.
* The request log stores no arguments or IPs.
* Alerts need recorded consent, store the area at about 1 km, expire within 30 days, and unsubscribing erases the contact and location.
* Admins switch datasets per type, and each change is audited.
* Staff RPCs aren't executable by anonymous users (migration 10), and function `search_path`s are pinned (migration 9).

**Before production:** set `app_settings.demo_mode = false` (disables `reset_demo`), delete the demo users, add a server-side pepper to code hashes, add IP-level rate limiting for anonymous uploads and reports (edge or WAF), complete a POPIA assessment, and use WhatsApp templates for proactive messages. The full checklist is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-before-real-data-not-done-in-the-hackathon-deployment).

## Project structure
```
src/
  components/{common,layout,chat,tourist,dashboard,maps}
  pages/{public,tourist,hotel,transport,admin,developers}   incl. /alerts/:token, /admin/ai, /developers
  context/AppContext.jsx        session, roles, live queries
  lib/mcp.js                    MCP endpoint + tiny browser client (portal, admin status)
  services/api.js               one client: Supabase or in-browser Postgres
  services/whatsapp/            simulator API for the shared engine
  services/transport/           provider adapters (hotel, shuttle, Uber Central mock)
  lib/localdb/                  PGlite worker + Supabase auth/role bootstrap
  lib/labels.js, intelligence.js, myTrips.js
  i18n/                         translation-ready (English shipped; fr/de/es/zh prepared)
supabase/
  migrations/                   schema → security → RPCs → demo seed → storage → MCP → alerts → AI admin → hardening
  seed.sql                      demo users + seed data
  functions/whatsapp-webhook/   Meta webhook + outbound dispatcher (bookings and safety alerts)
  functions/_shared/            conversation engine (shared with the web simulator)
mcp-server/                     public MCP server (Vercel): src/server.js tools, api/ functions, test/
skills/safearrival-travel-safety/   Agent Skill (agentskills.io format)
docs/                           DEPLOYMENT.md, DEMO.md, integrations/ (Claude, ChatGPT, other clients)
scripts/                        SQL, conversation and MCP test suites
```
