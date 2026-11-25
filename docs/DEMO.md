# Hackathon demo script: SafeArrival inside an AI assistant

About 8 minutes. Every record in the demo deployment is **fictional**, and the assistant's answers say so.

**Before you start**
- Claude (or ChatGPT Business/Enterprise) has the SafeArrival connector added. See
  [connect-claude.md](integrations/connect-claude.md). The skill is optional but gives better answers.
- A second tab is open at https://safearrival-one.vercel.app. Click **Admin** in the presenter bar at the bottom.
- `https://safearrival-mcp.vercel.app/health` shows `"ok": true`.
- Optional: **Admin → AI integrations** on a third screen, to show calls arriving live.

| # | Do / say | What happens | Point out |
|---|---|---|---|
| 1 | Open a new chat and switch on **SafeArrival** (+ → Connectors) | The assistant now has 15 SafeArrival tools | No new app to install. It's the assistant the tourist already uses |
| 2 | *"I land at Cape Town International tonight. Is the area around the airport safe?"* | The assistant calls `check_area_safety` (and often `get_safety_alerts`) | — |
| 3–5 | Read the answer | Counts of verified incidents, unverified reports and the advisory; the common issue (cash "airport fee"); precautions; the DEMO DATA notice | **No "safe/unsafe" verdict.** Verified and unverified items are labelled. "No reports ≠ safe" |
| 6 | *"How can I verify my shuttle driver when I arrive?"* | `get_pickup_guidance`, sometimes also `verify_transport_provider` | — |
| 7–8 | Read the answer | Meet at the designated pickup point. **The driver says your code first.** Check the plate. A sign with your name isn't proof | This is the existing SafeArrival verification flow, now available inside the assistant |
| 9 | *"Can you alert me if anything happens near the V&A Waterfront while I'm there?"* | The assistant explains what alerts cover and **asks for consent** | It can't subscribe without consent; the server refuses |
| 10 | *"Yes, please."* | `subscribe_safety_alerts` returns a reference and a **manage link**. Open the link | Monitoring runs in SafeArrival's backend; the chat can close |
| 11 | Ask the assistant to report a demo incident at the Waterfront rank (e.g. *"Report: a man at the V&A taxi rank offered me an unofficial cash ride"*). It shows the report and asks you to confirm | `report_safety_incident` returns `SAFE-…`, **unverified** | Nothing alerts yet: unverified reports never trigger alerts |
| 12 | In the admin tab: **Incidents** → open the new report → **Public safety intelligence** → write a summary → **Publish as verified**. Refresh the manage link | The alert appears: what, where, when, "Verified by the SafeArrival safety team", a precaution, 10111/112 | Only safety-team-verified incidents notify people. The traveller's own words are never published |

**Close with** `/developers` (tool reference loaded live from the server) and **Admin → AI integrations** (real calls
from Claude and ChatGPT, dataset switches).

**If something goes wrong**
- *The assistant answers without calling a tool:* say "Use SafeArrival to check…".
- *Rate limited:* each caller gets 3 submissions per hour. Use another network, or wait.
- *Admin panel missing:* make sure you're signed in as the admin (presenter bar → Admin).
- *Reset:* presenter bar → Reset (as the admin) restores the seed data **for everyone** on the shared deployment.
  Existing subscriptions are kept, and resets never trigger alerts.
