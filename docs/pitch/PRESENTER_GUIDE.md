# SafeArrival: 5-minute pitch, presenter guide

Deck: https://claude.ai/artifact/QzEaZwMGjhZXmJTwP5jDFw (speaker notes are on every slide)
Live app: https://safearrival-one.vercel.app · MCP endpoint: https://safearrival-mcp.vercel.app/mcp
Screenshots used in the deck: `docs/pitch/shots/` · 23-second launch video (optional walk-on): `brag-output/brag.mp4`

**The story in one line:** anyone can hold a sign with your name; only your real driver knows your code.
**The three things judges must leave with:** (1) arriving visitors have no way to check who they're getting into a car with; (2) one simple rule, "the driver says my code first", delivered where visitors already are, fixes that moment; (3) we have a six-week pilot with six numbers to prove it.

---

## 1. What is real today (read this before you present)

| Capability | Status | Say it like this |
|---|---|---|
| Booking page: driver card, one-time code, verify, "Something's wrong", report tracking | **Built, live** | "This is running now." |
| Hotel, transfer operator, driver and safety-team dashboards | **Built, live** | |
| AI assistant tools over MCP (15 tools: area reports, pickup guidance, emergency numbers, report, alerts, feedback…) | **Built, live**, verified 25 Nov 2026 (`/health` ok, `check_area_safety` and `get_pickup_guidance` return data) | "ChatGPT or Claude can look things up in SafeArrival." |
| Visitor feedback + admin "Goals & targets" (baseline, target, live current value) | **Built, live** | "The measurement is built in." |
| WhatsApp conversation (menus, booking, verify, report, emergency) | **Built, but only runs in a browser simulator.** The production webhook exists but has never been connected to a real Meta number. | "This is our WhatsApp flow running in a simulator." Never say "live on WhatsApp". |
| Real hotels, operators, vetted drivers, partnerships | **None.** All data is fictional and labelled DEMO DATA. | "Demo data." "We'll approach…" Never "our partners". |
| Uber integration, GPS tracking, other languages, payments | **Not built** (Uber is a labelled mock) | Don't mention unless asked. |

**Never claim:** that an area is safe, that SafeArrival prevents crime, a user number, a partner, or a crime statistic you can't source.

---

## 2. Timed script (5:00)

The words below match the speaker notes in the deck. Aim for about 140 words a minute; the script is about 690 words, which leaves room for the demo's waiting time.

| Time | Slide | Say |
|---|---|---|
| 0:00–0:20 | 1 · Cover (three "SARAH M." signs) | "Picture Sarah. She's just landed at Cape Town International after an eleven-hour flight. No local SIM, two suitcases, a bit of cash. She walks into arrivals and there are three people holding a sign that says SARAH M. Anyone can hold a sign with your name. Names leak from booking emails, luggage tags, a conversation at the counter. So how does Sarah know which one is her driver, before she gets in the car?" |
| 0:20–0:45 | 2 · The moment of vulnerability | "This is the moment we're designing for: the few metres between the arrivals hall and the car door. Sarah is tired and probably offline. The only proof of identity is a name on a sign, and that's trivial to copy. She doesn't know what the fare should be, so a cash 'airport fee' sounds plausible. And if something does go wrong, the hotel, the shuttle company, the airport and the police each own a piece of it. Most visitors just fly home and never report it. So at this exact moment, a visitor has no simple way to check who they're getting into a car with." |
| 0:45–1:05 | 3 · The intervention | "SafeArrival flips the check around. Instead of the tourist trusting a sign, the driver has to prove who they are. When the hotel books Sarah's transfer, she gets the driver's name, car, plate and the agreed price on WhatsApp, plus a one-time code like BLUE TABLE 47. The same code goes to the real driver. At the kerb, the driver has to say it first. No code, no ride. Know who's picking you up, know what you should pay, know who to contact." |
| 1:05–1:30 | 4 · Three doors | "Visitors don't want another app, so SafeArrival comes to them through three doors. WhatsApp, because that's what most visitors and drivers already use. A web link for the booking itself. And the AI assistants people already ask travel questions, like ChatGPT and Claude. We connect through MCP, which simply lets an assistant look things up in SafeArrival instead of guessing. Behind all three is one set of rules, so the answer is the same whichever door you use. Let me show you Sarah's journey." |
| 1:30–3:00 | 5–7 · Live demo | See section 3. |
| 3:00–3:30 | 8 · Why it reduces risk | "Risk at the kerb comes from uncertainty: who's my driver, what should I pay, who do I call. SafeArrival answers those before Sarah lands, and gives her one rule that's easy to follow when she's exhausted: the driver says my code first. An impostor can copy a name. They can't know a code that was only sent to the real driver. We can influence which car she gets into, what she pays, and whether a problem reaches someone who can act. We can't promise an area is safe, and we never tell anyone that it is." |
| 3:30–4:10 | 9 · Measuring impact | "We want to be judged on numbers, so here are six we'll report whether they're good or bad. The pilot runs six weeks. Weeks one and two are the baseline: same hotel, same arrivals, no SafeArrival, and a two-question survey. Weeks three to six, SafeArrival is live. The headline is verified pickups: today zero percent of transfers have any identity check; we're aiming for seventy percent. Confidence: eighty percent of visitors say they felt more confident, and twenty points above the baseline group. We'll track whether our answers are rated helpful, how fast a human responds to a report, and we'll count every pickup where a check failed and the visitor didn't get in. These are proposed targets, not results, and the product already logs every one of them." |
| 4:10–4:45 | 10 · Pilot and scale | "Six weeks, one arrivals door: International Arrivals at Cape Town International, one hotel group with two or three properties, and the transfer company it already uses. We don't have partners signed yet. We'll approach a hotel group and an operator first, then Cape Town Tourism and Airports Company South Africa, mainly for a sign at the pickup zone. What it needs is mostly permissions: WhatsApp Business approval and message templates, a POPIA privacy review, and a small safety team on a rota. If the numbers hold, we add more Cape Town hotels, then the Winelands and Garden Route, then other airports. The honest constraint: it only works when the operator sends the code to the driver, which is why we start with one." |
| 4:45–5:00 | 11 · Close | "Back to Sarah at the arrivals door. Anyone can hold a sign with her name. Only her real driver knows her code. We're looking for one hotel group and one transfer operator to pilot it with us. Thank you." |

Slide 12 (appendix: built / simulated / next, plus the Goals screenshot) is for Q&A only.

---

## 3. Live demo guide (90 seconds, three tabs)

One continuous story: **before landing → at the kerb → if she feels unsafe.**

### Set-up (15 minutes before, on the presenting laptop)

1. **Health check.** Open https://safearrival-mcp.vercel.app/health and confirm `"ok": true` and `"database": "reachable"`.
2. **Tab A: AI assistant.** Claude (any plan that supports custom connectors) or ChatGPT on a plan with custom connectors / developer mode. Add the connector following `docs/integrations/connect-claude.md` or `connect-chatgpt.md`. Open a **new chat**, switch the SafeArrival connector **on**, and do a throwaway test question so the connector is warm. Then open a fresh chat for the demo.
3. **Tab B: booking page with a driver assigned.**
   - On https://safearrival-one.vercel.app open **Arrange transport** (or the presenter bar → Tourist) and book: Saltwater Lodge → International Arrivals → Today → any time → 1 passenger → 1 bag → Saltwater Lodge Transfers → Confirm.
   - Presenter bar → use the hotel shortcut to confirm and assign Michael Daniels (or sign in as Hotel and assign him by hand).
   - Open the booking page link (`/trip/…`), scroll to **Your verification code**. Leave the tab there.
   - Don't use the "Check" box during set-up: it allows 5 checks per 10 minutes.
4. **Tab C: WhatsApp simulator.** https://safearrival-one.vercel.app/assistant?hotel=hotel-001 → click **Send "Hi"** so the welcome and the **Choose an option** button are showing.
5. **Collapse the presenter bar** (chevron) in tabs B and C so it isn't on screen.
6. Browser zoom 125% on tabs B and C so the back row can read them. Notifications off. Phone silent.
7. Never press **Reset** in the presenter bar: it wipes the shared demo data for everyone.

### The 90 seconds

| Time | Slide on screen | Do | Type exactly | Audience sees | Say while it works |
|---|---|---|---|---|---|
| 1:30 | 5 (Before landing) | Switch to Tab A | `I land at Cape Town International tonight. Is the area around the airport safe?` | The assistant calls SafeArrival (`check_area_safety`, often `get_safety_alerts`). Answer lists a SafeArrival advisory plus verified and unverified reports near International Arrivals; the common issues are a cash "airport fee" and touting inside the terminal; precautions; a DEMO DATA notice; no safe/unsafe verdict. | "Sarah's on the plane. Instead of googling, she asks the assistant she already uses. Because SafeArrival is connected, it isn't guessing, it's reading our labelled reports." Then point: "the real pattern… verified versus unverified… and it never says 'safe'." |
| 2:00 | 6 (At the kerb) | Switch to Tab B (code visible) | In "Optional: type what the driver said": `red door 12` → **Check** | Red: "That does NOT match. Do not get into the vehicle." | "Sarah's landed. Her page shows her driver, car, plate, price and her code, and the driver must say it first. Now a man with her name on a sign walks up. She asks: what's my code? He guesses." … "Wrong code, don't get in. No judgement call for a tired traveller." |
| 2:25 | 6 | Click **Code does not match** | — | The report form opens, pre-filled with the category | "One tap and the hotel, the transfer company and our safety team are alerted." Don't fill in the form. |
| 2:40 | 7 (If she feels unsafe) | Switch to Tab C → **Choose an option** → **Emergency assistance** | — | Police 10111, ambulance 10177, 112 from any mobile, then "move to a busy, well-lit public area" | "Emergency numbers come first, in the chat she already has open. This is our WhatsApp flow running in a simulator; connecting a live WhatsApp Business number is part of the pilot." |
| 3:00 | 8 | Back to slides | | | |

### Backup plan

The demo slides (5, 6, 7) are built to stand alone: each shows the real screen and the real output of the same call.

| What goes wrong | Do this (don't apologise for more than one sentence) |
|---|---|
| Assistant answers without using SafeArrival | Type `Use SafeArrival to check.` If still nothing in 10 s, go to the next row. |
| Assistant slow (over 10 s) or the connector fails | "While that loads, here's what it returned when we ran it this morning." Stay on slide 5 and read its three result lines. |
| Booking page won't load / wrong state | Stay on slide 6. Say the same words over the screenshot: point at the code, the orange bar, the options. |
| "Check" says too many attempts | Skip typing; click **Code does not match** directly. |
| WhatsApp simulator stuck | Stay on slide 7: both phone screenshots show the menu and the emergency reply. |
| No internet at all | Present slides 5–7 as a walkthrough. Optional: run the local demo with no backend (`npm run dev` with no Supabase variables; everything runs in the browser) for tabs B and C; the AI beat still needs internet. |
| Running long | Drop beat 3 (go from slide 6 straight to slide 8). Never cut slides 9 or 10. |

Rehearse the demo at least three times with a timer. If you can't hit 90 seconds twice in a row, present beats 1 and 3 from the slides and only do beat 2 live.

---

## 4. Judging-criteria coverage

| Criterion (weight) | Where it's addressed | The evidence judges hear |
|---|---|---|
| Problem definition (20%) | Slides 1, 2 (0:00–0:45) | A specific visitor (first-time international arrival on a pre-booked transfer), a specific place and moment (CTIA International Arrivals, hall to car door), four concrete failure modes (offline, copyable identity, unknown price, fragmented reporting). No invented statistics. |
| Intervention (20%) | Slides 3, 4, demo 5–7 (0:45–3:00) | What the visitor receives (driver, car, plate, price, one-time code), the one rule (driver says it first), and the three channels, shown working. |
| Risk-reduction logic (20%) | Slide 8 (3:00–3:30), reinforced in demo beat 2 | Uncertainty → early guidance → one rule at the kerb → fewer risky pickups accepted and more problems reported. Explicit limits: no area is "safe", crime elsewhere isn't addressed. |
| Measurable impact (20%) | Slide 9 (3:30–4:10), appendix slide 12 | Six measures, each with baseline, proposed target and data source; 2-week baseline + 4-week live design; logging already built into the product. |
| Pilot and scale (10%) | Slide 10 (4:10–4:45) | Place, duration, partners to approach (honestly unsigned), resources and permissions, main constraint, expansion path. |
| Pitch (10%) | Whole deck | One character, one story, a callback close, under 5:00, technology framed as "doors", not the point. |

---

## 5. Pilot and impact measurement framework

**Question the pilot answers:** when arriving visitors get a one-time driver code and simple guidance, do more of them check their driver, feel more confident, and refuse risky pickups?

**Design**
- **Where:** Cape Town International Airport, International Arrivals designated pickup area.
- **Who:** guests of one hotel group (2–3 properties) on airport transfers run by the operator the hotel already uses.
- **When:** 6 weeks. Weeks 1–2 baseline (no SafeArrival; short post-arrival survey of guests). Weeks 3–6 SafeArrival live for every airport transfer.
- **Comparison:** the same properties before vs after. If a second, similar property joins without SafeArrival, use it as a concurrent comparison group.

**Measures** (all targets are proposals, to be agreed with the partners before week 1)

| # | Measure | Definition | Baseline | Proposed target | Data source (already in the product unless noted) |
|---|---|---|---|---|---|
| 1 | Verified pickups | Pilot transfers where the guest recorded "Driver verified" after the driver said the code ÷ all pilot transfers | 0% (no check exists) | ≥ 70% | Verification log per booking; transport verification rate KPI |
| 2 | Confidence | Guests answering "Yes" to "Did SafeArrival make you more confident about your pickup?" | Weeks 1–2 survey: "How confident did you feel about your pickup?" (non-users) | ≥ 80% "Yes", and +20 points vs baseline confidence | WhatsApp feedback flow (confidence rate KPI); baseline survey is new (paper/QR at the front desk) |
| 3 | Useful guidance | Safety answers (WhatsApp tips, AI tool calls with feedback) rated "Helpful: Yes" | None | ≥ 75% | `submit_feedback` / feedback table |
| 4 | Time to help | Median minutes from a report to the first human response | Measured weeks 1–2 from hotel/operator logs | ≤ 20 minutes | Incident timeline (incident acknowledgement KPI) |
| 5 | Risky pickups refused | Failed checks (code, details, vehicle mismatch) where the guest didn't get in, confirmed by a follow-up message | Not recorded today | No target: report every one | Verification log + follow-up |
| 6 | Reach | Partner airport transfers that used SafeArrival ÷ the operator's airport-transfer list | 0% | ≥ 60% | Bookings vs operator's list |
| 7 | Operator effort (guard-rail) | Extra minutes per transfer for hotel/operator staff | n/a | ≤ 2 minutes | Staff interview + timing in week 3 |

**Feedback collection:** the built-in WhatsApp prompt after a pickup or report (optional, anonymous, at most once every 12 hours, never after someone asks for help); a 2-question baseline survey at check-in for weeks 1–2; a 15-minute interview with front-desk and operator staff at weeks 3 and 6.

**Success means:** measures 1 and 2 hit target, measure 7 stays under 2 minutes, and no serious incident goes unanswered. **Failure is also a result:** if verification stays under 40%, we learn whether the problem was the operator not sending codes, drivers not saying them, or guests not asking, and fix that before scaling.

**Ethics and privacy:** POPIA review before launch; guests opt in to WhatsApp messages; reports are labelled unverified until the safety team reviews them; no safety scores; locations shown approximately.

---

## 6. Ten likely judge questions

1. **How is this different from Google Maps or a normal AI chatbot?**
   Maps tells you where to go; a chatbot gives general advice from the internet. Neither can tell you whether *this* driver is *your* driver. SafeArrival's core is the one-time code that only the real driver receives. The AI connection just puts our labelled, Cape Town–specific guidance inside the assistant people already use.

2. **Why do you need MCP?**
   We don't need it for the core check; that works on WhatsApp and the web. MCP is a distribution channel: visitors already ask ChatGPT or Claude "is it safe to…", and MCP lets those assistants answer from our labelled reports and pickup guidance instead of guessing. It took one small server, and it's live with 15 tools.

3. **Why WhatsApp as well?**
   It's what visitors and drivers already have, it works on roaming data and hotel Wi-Fi, and nothing needs installing. Honest status: the WhatsApp flow is built and runs in a simulator today; connecting a real WhatsApp Business number, with Meta-approved message templates, is a pilot task.

4. **How do you keep safety information accurate and up to date?**
   Every item is labelled: verified by our safety team, an unverified traveller report, or an official advisory, with its date. Unverified reports never trigger alerts, raw traveller text is never published, and advisories expire. In the pilot, a named safety-team member reviews every report. We never call anywhere "safe".

5. **What if a tourist has no internet?**
   The code is sent before they travel, so it's already on the phone; the kerb check itself needs no data, just "what's my code?". Hotel Wi-Fi and airport Wi-Fi cover the booking. Emergency numbers (10111, 10177, 112) are in the first messages. SMS fallback is not built; we'd consider it if the pilot shows a need.

6. **How do you protect tourist privacy?**
   No app account; the booking page is a private link. Staff never see the code, and it's deleted from message history once used. Reports shared publicly carry no names or descriptions, and locations are approximate. Alert subscriptions need explicit consent and are erased on unsubscribe. A formal POPIA review is a pre-pilot requirement.

7. **How would you show it actually reduces risk?**
   We can't count crimes that didn't happen, so we measure behaviour and outcomes we can observe: how many pickups were verified, how many failed checks ended with the visitor not getting in, how fast reports got a human response, and visitor confidence against a baseline group. Those are leading indicators; a longer pilot with the airport could add incident trends.

8. **Who maintains the information?**
   Hotels and operators maintain their own drivers, vehicles and prices in the dashboards. A small SafeArrival safety team reviews reports and publishes advisories. In the pilot that's our team on a rota; at scale, it's a paid function funded by partners.

9. **How would you secure partnerships?**
   Start with one hotel group and the operator it already uses: their pitch is fewer guest incidents and protection from impostors using their name, at no cost during the pilot. With pilot numbers, approach Cape Town Tourism and ACSA. No partnerships are signed today.

10. **How does it become financially sustainable?**
    Tourists use it free. Hotels pay a small per-property subscription or per verified transfer, operators pay for verified-operator status and brand protection, and tourism bodies or the airport may sponsor the safety-information service. The pilot tests willingness to pay; we're not claiming revenue yet.
