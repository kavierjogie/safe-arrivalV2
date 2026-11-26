# WhatsApp intelligence, MCP parity and incident management

Status: implemented and tested locally (PGlite, the real migrations), 26 Nov 2026. **Not yet applied to the hosted Supabase project, not deployed, not tested against a live Meta WhatsApp number.**

## 1. Audit of what existed

| Component | What it did | Reused? |
|---|---|---|
| `supabase/functions/_shared/conversation.js` | Pure-JS state machine (29 states), 10-row menu, booking, driver verification, accommodation/provider checks, incident reporting, status, tips, feedback, emergency keywords | Yes: extended, not replaced. Same `handle(session, input, api)` contract |
| `supabase/functions/whatsapp-webhook/index.js` | Meta signature check, last-message dedupe, 30/min flood limit, session storage, `START <hotel>` deep links, outbound dispatcher for `notifications` and `alert_deliveries` | Yes: extended |
| `src/services/whatsapp/simulator.js` | Same engine in the browser, same RPCs | Yes: four API methods added |
| `public.mcp_call` + `private.tool_*` (migrations 6, 7, 11) | 15 MCP tools; secret check, per-client rate limit, request log | Yes: the runner is now shared with WhatsApp |
| `public.report_incident`, `get_incident`, `update_incident`, `assign_incident_handler`, `set_incident_verification` | Incident pipeline, staff updates, publication to the public | Yes: wrapped / extended |
| `incidents.verification_status`, `public_summary`, `public_until` | CTT/admin control of what the public sees (unverified / verified / advisory / rejected, with expiry) | Yes: this IS the source of truth both channels read |
| `hotels`, `transport_providers` (status pending/active/suspended), `safety_advice`, `emergency_contacts` | Admin-managed provider, accommodation, guidance and emergency records | Yes, unchanged |

Gaps found: WhatsApp could not reach the area, route, alerts, pickup-guidance, travel-advice, emergency-services, subscribe or manage tools (they sat behind the MCP secret); typed text outside a few keywords was rejected ("Please choose an option"); incidents were submitted without a confirmation step; incidents had no priority, no case-management statuses, no way to reach a WhatsApp reporter without a booking, no visitor follow-up, and no duplicate protection on submission.

### Booking discrepancy (documented, not changed)
SafeArrival is positioned as a visitor **verification and safety-support** platform, but WhatsApp also lets visitors **request transport bookings** through partner hotels (`create_booking`). That is a commercial transport flow: it creates obligations for hotels/providers (pricing, confirmation, cancellations) that a safety platform run with Cape Town Tourism may not want to own.
What this change does: the booking flow is kept intact and reachable (menu row *My booking* → *Arrange transport*, and typed "book a transfer"), but it is no longer a top-level menu row because the menu now leads with safety checks. Nothing about booking was expanded. **Decision needed from CTT:** keep booking as a pilot feature, hand it entirely to hotels, or remove it (removing it would also remove driver codes for new trips, since codes come from bookings).

## 2. How WhatsApp works now

- **Menu kept** (10 rows): Check area safety · Check a route · Verify transport company · Check accommodation · My booking · Verify my driver · Report a concern · Check my report · Safety advice & alerts (sub-list: tips by stage, current alerts, get alerts, stop alerts, pickup guidance, feedback) · Emergency / ask a question. `hi`, `menu`, `restart`, `help` open it; a row number ("3") also works.
- **Free text anywhere.** `detectIntent()` (deterministic keyword rules, no AI model) maps text to one of: AREA_SAFETY, ROUTE_SAFETY, SAFETY_ALERTS, TRANSPORT_PROVIDER_CHECK, DRIVER_VERIFICATION, ACCOMMODATION_CHECK, INCIDENT_REPORT (+ category), INCIDENT_STATUS, INCIDENT_FOLLOWUP, SAFETY_GUIDANCE (+ category), PICKUP_GUIDANCE, EMERGENCY, EMERGENCY_SERVICES, ALERT_SUBSCRIPTION, ALERT_MANAGEMENT, FEEDBACK, BOOKING_LOOKUP, HUMAN_SUPPORT, HOW_IT_WORKS, MAIN_MENU, GENERAL_QUESTION. It only chooses where to send the request; it never produces safety content.
- **Mid-flow text:** in a step that expects typing, text is the answer unless it is a clear *question* about something else; then the question is answered, the unfinished report/booking is remembered (`ctx.paused`) and a *Continue / Discard* prompt appears. Incident drafts live in `ctx.report`, which nothing else touches, so collected answers are never lost.
- **Places:** typed names resolve through `public.resolve_place` (16 Cape Town places + pickup points + partner hotels' areas; "my hotel" uses the visitor's hotel). WhatsApp **location pins** are accepted anywhere.
- **Unclear text:** a short clarification listing what SafeArrival can do, plus the menu.
- **Emergency words** (emergency, police, ambulance, danger, help me, knife, bleeding…) always send 10111 / 10177 / 112 first, even mid-answer, then offer to record the incident. Nothing claims police or an ambulance were contacted.

### MCP capability map (one implementation, two channels)

| MCP tool | WhatsApp intent / entry | Path |
|---|---|---|
| check_area_safety | AREA_SAFETY, menu *Check area safety*, location pin | `assistant_tool` → `private.tool_check_area_safety` |
| check_route_safety | ROUTE_SAFETY ("from X to Y"), menu *Check a route* | `assistant_tool` |
| get_safety_alerts | SAFETY_ALERTS, *Current alerts* (verified + advisories only) | `assistant_tool` |
| get_travel_safety_advice | SAFETY_GUIDANCE with a context (night, airport, e-hailing, shuttle, outdoors) | `assistant_tool` |
| verify_transport_provider | TRANSPORT_PROVIDER_CHECK | `check_transport_provider` → same `private.provider_lookup` |
| verify_driver | DRIVER_VERIFICATION | existing booking flow: `check_spoken_code` / `record_verification` (same functions `verify_driver` calls) |
| check_accommodation | ACCOMMODATION_CHECK | `check_accommodation` → same `private.accommodation_lookup` |
| report_safety_incident | INCIDENT_REPORT, *Report a concern* | `report_incident` (the function the MCP tool wraps) |
| get_incident_status | INCIDENT_STATUS, *Check my report* | `get_incident` (same rows, by tracking token) |
| get_safety_guidance | *Safety advice* stages | `safety_guidance` (same function the tool wraps) |
| get_pickup_guidance | PICKUP_GUIDANCE | `assistant_tool` |
| find_emergency_services | EMERGENCY_SERVICES, menu *Emergency* | `assistant_tool` (core numbers also hard-coded so they show if the DB is down) |
| subscribe_safety_alerts | ALERT_SUBSCRIPTION (explicit *Yes, send alerts* tap or typed "yes") | `assistant_tool`; row marked `source = 'whatsapp'` |
| manage_safety_alerts | ALERT_MANAGEMENT ("stop alerts") | `assistant_tool` |
| submit_feedback | FEEDBACK | existing `request_feedback` / `submit_feedback` |

`private.run_tool` is now the single runner (validation, rate limits, logging). `mcp_call` = secret check + runner (contract unchanged). `assistant_tool` = runner with the WhatsApp id hashed into the rate-limit bucket and `client_name = 'whatsapp'`, so tool timing and failures for WhatsApp appear in `mcp_requests` and on the admin *AI integrations* page as "WhatsApp (SafeArrival)".

## 3. CTT admin platform as the source of truth

Both channels read the same rows through the same functions; WhatsApp formats, it never adds facts. Classification shown to visitors:

| Label | Record | Dates shown |
|---|---|---|
| 🛡️ SAFETY ADVISORY | `verification_status = 'official_advisory'` (published by an admin with a summary) | reported, reviewed, updated, current-until (or "EXPIRED, historical only") |
| ✅ VERIFIED INCIDENT | `verification_status = 'verified'` | same |
| ⚠️ UNVERIFIED REPORT | `unverified`, shown only as category label, never the visitor's text | reported + "N days ago", "not yet confirmed" |
| GENERAL GUIDANCE | `safety_advice`, `category_precaution` | last updated where returned |

Rejected items are never shown; expired advisories are excluded from current alerts and flagged as historical elsewhere; "no reports" is always followed by "that does not mean the area is safe". Tested: rejecting an advisory in the admin removes it from WhatsApp and MCP in the same request cycle.

Requested review lifecycle → existing model: *Submitted* = `unverified` + status `received`; *Under review* = `unverified` + `triage/assigned/in_progress`; *Verified* = `verified` or `official_advisory`; *Rejected* = `rejected`; *Expired* = `public_until` in the past. **Not implemented:** *Draft* (admins publish directly) and a separate *Archived* state (an expired item is the archive). A visitor report can only become public through `set_incident_verification`, which requires an admin and a written public summary.

## 4. Incident case management

- **Categories:** existing 13 kept; added `stranded`, `medical_emergency`, `personal_safety` (service `general`). Harassment maps to the existing `intimidation` ("Harassment, intimidation or threatening behaviour").
- **Conversational report:** concern recognised from free text (e.g. "my driver has a different number plate") → the category's approved precaution immediately (and "do not get into the vehicle" for mismatches) → one question at a time: location (or pin, or known pickup point), "Are you safe right now?" → summary → **Yes, submit / Change details / No, cancel**. Only *submit* creates the record.
- **Idempotency:** each draft carries a random `idempotency_key`; a repeated submit returns the same case (`duplicate: true`).
- **Record:** reference, tracking token, category, description, location, booking, hotel/provider, `priority` (+ `priority_source`), `visitor_safe`, `escalated_to`, `resolution`, `handler_id` (case owner), timeline (`incident_updates`, public vs internal), `contact_whatsapp` (only accepted from the webhook's service role), timestamps.
- **Priority:** suggested on insert (critical: immediate help / medical; urgent: intimidation, stranded, personal safety, unsafe accommodation, booking-linked mismatch or payment demand; else standard). The system only ever raises it; admins can change it with a reason (internal note + audit).
- **Lifecycle:** existing statuses kept, added `triage`, `assigned`, `in_progress`, `awaiting_visitor`, `awaiting_partner`, `unable_to_contact`. Assigning an owner moves a new case to `assigned` and tells the visitor. `awaiting_visitor` must be shared with the visitor. Partners cannot set triage/assigned/unable-to-contact or close.
- **Visitor follow-up:** "check my report" / "has there been an update" → updates + *Add information / I'm safe now / I need more help* (`public.incident_followup`, token-protected, 10/hour). Updates the same case; information arriving while `awaiting_visitor` moves it to `in_progress`; "need more help" raises standard → urgent and alerts the dashboard; closed cases refuse follow-ups; nothing resolves or downgrades automatically.
- **Admin dashboard:** overview tiles (total, critical, urgent, unassigned, in progress, escalated, awaiting visitor, awaiting partner, resolved, closed); queue sorted by priority with search by reference and filters for priority, status, category, location, owner, date; drawer shows priority, case owner, visitor-safe, channel, escalation destination, resolution, and a *Case management* panel (change priority, ask visitor, escalate to a named destination). Internal notes stay internal (tested).

## 5. Outbound notifications

`private.notify_reporter` writes WhatsApp rows for booking-linked visitors *and* WhatsApp reporters without a booking (received → via in-chat reply; assigned, info request, escalated, resolved, closed, any public update → via `notifications`). The dispatcher now:
- sends free-form text only if the visitor messaged within the last 24 hours (`whatsapp_sessions.updated_at`);
- otherwise uses `WHATSAPP_UPDATE_TEMPLATE` if configured, else marks the row `not_configured`;
- records `sent` / `failed` / `not_configured` from the actual Graph API result; never claims delivery otherwise.

Messages needing an approved template: incident updates outside 24h (`WHATSAPP_UPDATE_TEMPLATE`, 1 variable), safety alerts (`WHATSAPP_ALERT_TEMPLATE`, 3 variables, existing), and booking/driver notifications to a tourist or driver who has not messaged in 24h (they use the same update template path).

## 6. Performance and reliability

- Webhook returns 200 immediately; processing continues via `EdgeRuntime.waitUntil`.
- Duplicate Meta deliveries: race-safe insert into `whatsapp_inbound` (primary key = message id).
- 8 s timeout on every RPC, 10 s on Graph API calls; errors become a friendly reply.
- 60 s in-isolate cache for public lists only (hotels, pickup points, category labels). No booking, incident or tool results are cached.
- Structured log line per message: `engine_ms`, `total_ms`, replies, send failures (no phone numbers or text). Tool timings/failures in `mcp_requests`.
- New indexes: `incidents (priority, status)`, `incidents (handler_id)`.
- **Not measured yet:** real latency on the hosted stack. No claim of MCP-level performance is made until it is measured against the deployed function.

## 7. Security

Kept: Meta signature validation, MCP secret on `mcp_call`, RLS, staff-only RPCs revoked from anon, booking-token/code handling. New: `set_incident_priority` and `escalate_incident` are admin-only and not executable by anon; `contact_whatsapp` is only stored when the caller is the service role; WhatsApp ids are hashed in rate-limit buckets; `whatsapp_inbound` is service-role only; public results checked for phone numbers, tokens and raw descriptions.
Known limits: anonymous callers of `assistant_tool` can rotate `p_client` to dodge the per-visitor limit (same as an IP-rotating MCP client). Hotel/provider staff who can already see an incident row can also see its `contact_whatsapp` (same exposure as the tourist's booking number today). Phone number alone never grants access to records: reports are reached by tracking token.

## 8. Files and migration

- `supabase/migrations/20261126000013_whatsapp_parity_incident_cases.sql` (new): `private.run_tool`, `mcp_call` refactor, `public.assistant_tool`, `places` + `resolve_place`, new categories/statuses/columns, priority trigger, `incident_category_info`, idempotent `report_incident` wrapper, `notify_reporter`, `update_incident` / `assign_incident_handler` updates, `set_incident_priority`, `escalate_incident`, `incident_followup`, `whatsapp_inbound`, `client_family` WhatsApp label, `not_configured` delivery status.
- `supabase/functions/_shared/conversation.js`: intent layer, hybrid routing, pause/resume, new flows, confirmation step, follow-ups.
- `supabase/functions/whatsapp-webhook/index.js`: new API methods, cache, timeouts, background processing, dedupe table, location messages, metrics, 24h-aware dispatch.
- `src/services/whatsapp/simulator.js`, `src/services/api.js`: simulator parity.
- `src/pages/admin/AdminIncidentsPage.jsx`, `src/components/dashboard/Tables.jsx`, `src/components/dashboard/IncidentDrawer.jsx`, `src/components/common/StatusBadges.jsx`, `src/lib/labels.js`: dashboard.
- `scripts/test-whatsapp-intelligence.mjs` (new), `scripts/test-conversation.mjs` (confirmation step), `package.json` (`test:wa`), `README.md`.

## 9. Tests

`npm test` runs 7 suites on PGlite with every migration; all pass. The new suite covers: intent rules for every example in the brief; all 10 menu rows; menu/restart mid-flow; row numbers; area (named place, "my hotel", location pin), route (one sentence and step by step), provider, accommodation, guidance, how-it-works, human support, current alerts, pickup guidance, clarification; **WhatsApp result == MCP result** for the same query; classification labels and dates; raw descriptions never shown; admin reject/expire reflected on both channels; alert consent (refusal creates nothing; subscription marked WhatsApp; stop alerts erases the number); conversational report with a question mid-way and resume; confirmation; idempotent double submit; priorities; emergency numbers first and no dispatch claim; emergency words while typing; admin priority/assign/info-request/escalate/resolve/close; partner and anon refusals; visitor follow-ups update the same case; internal notes hidden; closed cases refuse follow-ups; MCP secret still required; driver checks still need a token; no phone numbers in rate-limit buckets; rate limit on WhatsApp writes.
Also verified in the browser simulator (demo mode) and on the admin incidents page, with no console errors.

**Not tested:** the edge function itself under Deno (it has no local test harness; only the shared engine is tested), live Meta delivery, templates, Database Webhook wiring, hosted-database performance.

## 10. Still needs live configuration

1. Apply migration 13 to the hosted Supabase project (the deployed web app calls the new RPCs).
2. Deploy `whatsapp-webhook` and set Meta secrets (README). Webhook has never been launched.
3. Create and get approval for the update template (and the alert template), set `WHATSAPP_UPDATE_TEMPLATE`.
4. Database Webhooks on `notifications` and `alert_deliveries` INSERT → `/dispatch`.
5. CTT to confirm: the booking-flow decision (§1), who the case owners (admin users) are, support hours promised in "a person can help", and the place list in `public.places`.
6. The MCP server needs no redeploy (its SQL contract is unchanged); re-run `node mcp-server/test/parity.mjs <url>` after the migration.
