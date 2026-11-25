# SafeArrival MCP server

Remote MCP server exposing SafeArrival's South African tourist transport-safety tools to AI assistants.
Streamable HTTP (MCP 2026-07-28, with stateless fallback for 2025-era clients) and stdio. Built on the official
`@modelcontextprotocol/server` SDK v2.

**Live endpoint:** `https://safearrival-mcp.vercel.app/mcp` (no auth) · health: `https://safearrival-mcp.vercel.app/health`

> Coverage today: Cape Town. Data is traveller transport-safety reports, not crime statistics. In demo mode every
> record is fictional and every response says so.

## Tools

| Tool | Writes? | What it does |
|---|---|---|
| `check_area_safety` | – | Reports within a radius: counts by category and verification status, period, freshness, guidance |
| `get_safety_alerts` | – | Advisories → verified incidents → unverified reports, with severity, expiry and precautions |
| `check_route_safety` | – | Reports in a corridor around the straight line origin→destination (no routing provider configured) |
| `verify_transport_provider` | – | SafeArrival partner status, contacts (approved only), service areas |
| `verify_driver` | records a code check | Booking token + what the driver said / plate / name → match or mismatch only |
| `report_safety_incident` | yes | Unverified report to the safety team; needs `user_confirmed: true`; 3/hour |
| `check_accommodation` | logs a check | Accommodation partner status, official contacts, phone-number consistency check |
| `get_incident_status` | – (may offer feedback) | Status and public updates of the caller's own report (tracking token) |
| `get_safety_guidance` | – | Approved guidance before arrival, during the visit, after an incident |
| `submit_feedback` | yes | Optional anonymous feedback after a result that offered `feedback.ref` |
| `find_emergency_services` | – | SA emergency numbers (10111, 10177, 112, …) plus local numbers |
| `get_pickup_guidance` | – | Designated pickup point, verification steps, impersonation warnings |
| `get_travel_safety_advice` | – | Curated, dated precautions + reported issues + active alerts |
| `subscribe_safety_alerts` | yes | Area alert subscription; needs `consent: true`; returns a private manage link |
| `manage_safety_alerts` | yes | View / pause / resume / update / unsubscribe by manage token |

**Alerts are monitored by the database, not the conversation:** publishing an incident as verified (admin) fires a
trigger. The trigger writes one `alert_deliveries` row per matching subscription (radius, categories, active, not
expired), with a unique key so nothing is sent twice. Web subscribers see alerts at `/alerts/<token>`. WhatsApp rows
go to the existing dispatcher, which needs an approved template (see the root README).

All logic lives in `public.mcp_call` ([migration 006](../supabase/migrations/20261124000006_mcp.sql)). This package
only validates input (zod) and forwards.

## Security model
- Uses the Supabase **anon/publishable key** plus `MCP_SERVER_SECRET` (sent as `x-mcp-secret`, checked against a
  hash in `private.mcp_config`). No service-role key.
- Rate limits in Postgres per salted IP hash: 60 reads/min, 3 submissions (reports + subscriptions)/hour. IPs are never stored.
- Subscriptions store the area at ~1 km precision, expire after at most 30 days, and unsubscribing deletes the number and location.
- Raw incident descriptions never leave the database (personal data, prompt injection); only categories and
  admin-written public summaries.
- `mcp_requests` logs tool, outcome, duration, user agent and a ~10 km area. No arguments.

## Run locally
```bash
cp .env.example .env          # fill in, then register the secret once (see .env.example)
npm install
npm run dev                   # http://127.0.0.1:8787/mcp
npm run stdio                 # stdio transport for desktop clients
```

## Test
```bash
npm test                              # protocol-level tests on PGlite (needs `npm install` in the repo root)
node test/smoke.mjs <server-url>/mcp  # read-only checks against a running server
```

## Deploy (Vercel)
New Vercel project → root directory `mcp-server` → env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MCP_SERVER_SECRET`.
Endpoints: `/mcp` (MCP) and `/health`.
