-- 11  Accommodation safety, shared visitor feedback, safety-check log, goals & targets.
--
-- Reuses what exists:
--   * Accommodation providers ARE the `hotels` table (partner status, contacts, area).
--   * Accommodation reports are ordinary `incidents` with accommodation categories, so the
--     existing pipeline (references, tracking tokens, updates, verification labels, MCP output) applies.
--   * Transport verification stays in `verification_attempts`; lookups of providers/accommodation
--     are logged in the new `safety_checks` (no personal data).
--   * One feedback service (`public.feedback` + request/submit functions) for WhatsApp AND MCP.
-- Visitor-facing access is only through WhatsApp (webhook, service role / simulator) and MCP (mcp_call).

-- ================================================================ incidents: accommodation categories
create or replace function private.accommodation_categories() returns text[]
language sql immutable as $$
  select array['listing_mismatch', 'booking_payment_fraud', 'host_identity_mismatch', 'accommodation_unsafe', 'accommodation_other']
$$;
create or replace function private.incident_categories() returns text[]
language sql immutable as $$
  select array['driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam', 'intimidation',
               'cannot_locate_driver', 'other'] || private.accommodation_categories()
$$;

alter table public.incidents drop constraint incidents_category_check;
alter table public.incidents add constraint incidents_category_check check (category in (
  'driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam', 'intimidation', 'cannot_locate_driver', 'other',
  'listing_mismatch', 'booking_payment_fraud', 'host_identity_mismatch', 'accommodation_unsafe', 'accommodation_other'));
alter table public.incidents
  add column service text generated always as (case when category in ('listing_mismatch', 'booking_payment_fraud', 'host_identity_mismatch',
    'accommodation_unsafe', 'accommodation_other') then 'accommodation' else 'transport' end) stored,
  -- What the report is ABOUT. Deliberately not hotel_id: the accommodation being reported must not
  -- see (through RLS) a complaint about itself or the reporter's details. Only admins see these.
  add column subject_hotel_id uuid references public.hotels (id) on delete set null,
  add column subject_name text check (char_length(subject_name) <= 120);
create index incidents_service_idx on public.incidents (service, created_at desc);

create or replace function private.category_label(c text) returns text
language sql immutable as $$
  select case c
    when 'extra_payment' then 'Unexpected request for extra payment' when 'driver_mismatch' then 'Driver did not match the booking'
    when 'vehicle_mismatch' then 'Vehicle did not match the booking' when 'code_incorrect' then 'Incorrect verification code'
    when 'suspected_scam' then 'Suspected transport scam / touting' when 'intimidation' then 'Intimidation or threatening behaviour'
    when 'cannot_locate_driver' then 'Could not find the booked driver'
    when 'listing_mismatch' then 'Accommodation did not match its listing'
    when 'booking_payment_fraud' then 'Suspicious accommodation booking or payment request'
    when 'host_identity_mismatch' then 'Accommodation provider identity or contact details inconsistent'
    when 'accommodation_unsafe' then 'Safety concern at an accommodation (check-in or location)'
    when 'accommodation_other' then 'Other accommodation problem'
    else 'Other transport problem' end
$$;

create or replace function private.category_severity(c text) returns text
language sql immutable as $$
  select case when c in ('intimidation', 'accommodation_unsafe') then 'high'
              when c in ('suspected_scam', 'extra_payment', 'driver_mismatch', 'vehicle_mismatch', 'code_incorrect',
                         'booking_payment_fraud', 'host_identity_mismatch') then 'medium'
              else 'low' end
$$;

create or replace function private.category_precaution(c text) returns text
language sql immutable as $$
  select case c
    when 'extra_payment' then 'Agree the price and payment method before pickup. A legitimate SafeArrival booking shows the agreed price; do not pay unexpected cash "fees".'
    when 'driver_mismatch' then 'Check the driver''s name and photo against your booking, and ask the driver to say your verification code first.'
    when 'vehicle_mismatch' then 'Check the registration plate, make and colour before getting in. If anything differs, do not get in.'
    when 'code_incorrect' then 'Never read your code out yourself. The driver must say it first; if they cannot, do not get in.'
    when 'suspected_scam' then 'Ignore unsolicited offers of transport inside terminals or on the street. Go to official ranks or meet your booked driver at the designated pickup point.'
    when 'intimidation' then 'Move to a busy, well-lit public place and contact the police on 10111 (or 112 from a mobile) if you feel threatened.'
    when 'cannot_locate_driver' then 'Wait at the designated pickup point and contact your hotel or provider; do not accept a lift from someone else.'
    when 'listing_mismatch' then 'Compare the address, photos and contact details with the booking platform before you pay or arrive. If they differ, do not pay more until you have confirmed with the platform.'
    when 'booking_payment_fraud' then 'Pay only through the booking platform or the accommodation''s official channel. Be wary of requests to pay a deposit by bank transfer to a personal account, or urgent "pay now or lose the room" messages.'
    when 'host_identity_mismatch' then 'Confirm the phone number and email from the accommodation''s official website or booking platform, not from a message you received.'
    when 'accommodation_unsafe' then 'If you feel unsafe, go to a busy public place or reception and call 10111 (police) or 112 from a mobile.'
    when 'accommodation_other' then 'Keep your booking confirmation and payment records, and report anything unusual.'
    else 'Keep your booking details handy and report anything unusual.' end
$$;

create or replace function private.limitations(extra text[] default '{}') returns jsonb
language sql stable as $$
  select to_jsonb(array[
    'SafeArrival data covers traveller reports about transport (pickups, drivers, touting, payment requests) and accommodation (listings, bookings, payments, check-in), not general crime.',
    'The absence of reports does NOT mean an area, route or accommodation is safe; it only means SafeArrival has not received reports.',
    'Unverified reports have not been confirmed by the SafeArrival safety team and must not be treated as confirmed crimes.',
    'Locations are approximate (pickup point or ~1 km) to protect the people who reported.'
  ] || extra || coalesce(array[private.demo_notice()], '{}'))
$$;

-- Same as migration 3, plus accommodation categories. Accommodation reports are routed to the
-- safety team only (never to the accommodation being reported); transport reports unchanged.
create or replace function public.report_incident(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.bookings; i public.incidents; h uuid; pr uuid; ev jsonb; subj uuid;
  cat text := p ->> 'category';
  urgent boolean := coalesce((p ->> 'needs_immediate_help')::boolean, false);
  is_acc boolean := cat = any (private.accommodation_categories());
begin
  if cat is null or not (cat = any (private.incident_categories())) then raise exception 'Please choose what went wrong'; end if;
  if char_length(coalesce(p ->> 'description', '')) > 2000 then raise exception 'Description is too long (2000 characters max)'; end if;
  if char_length(coalesce(p ->> 'subject_name', '')) > 120 then raise exception 'Name is too long (120 characters max)'; end if;
  if jsonb_array_length(coalesce(p -> 'evidence', '[]')) > 3 then raise exception 'Up to 3 photos per report'; end if;

  if nullif(p ->> 'booking_token', '') is not null then
    b := private.booking_by_token(p ->> 'booking_token');
    if (select count(*) from public.incidents where booking_id = b.id and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'Several reports were already received for this booking in the last hour. If you are in danger call 10111 or 112.';
    end if;
    if not is_acc then h := b.hotel_id; pr := b.provider_id; end if;
  elsif not is_acc then
    h := (select id from public.hotels where slug = p ->> 'hotel_slug' and status = 'active');
  end if;
  if is_acc then
    subj := (select id from public.hotels where slug = coalesce(nullif(p ->> 'subject_hotel_slug', ''), p ->> 'hotel_slug')
             or id::text = p ->> 'subject_hotel_id' limit 1);
  end if;

  insert into public.incidents (reference, booking_id, hotel_id, provider_id, tourist_id, category, description,
    pickup_point_id, location_text, needs_immediate_help, status, subject_hotel_id, subject_name)
  values ('SAFE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.incident_ref_seq')::text, 4, '0'),
    b.id, h, pr, b.tourist_id, cat, nullif(trim(p ->> 'description'), ''),
    case when is_acc then nullif(p ->> 'pickup_point_id', '') else coalesce(nullif(p ->> 'pickup_point_id', ''), b.pickup_point_id) end,
    left(nullif(trim(p ->> 'location_text'), ''), 200), urgent, 'received', subj, nullif(left(trim(p ->> 'subject_name'), 120), ''))
  returning * into i;

  for ev in select * from jsonb_array_elements(coalesce(p -> 'evidence', '[]')) loop
    insert into public.incident_evidence (incident_id, storage_path, content_type) values (i.id, ev ->> 'path', ev ->> 'content_type');
  end loop;

  insert into public.incident_updates (incident_id, status, message) values
    (i.id, 'received', 'Your report has been received and logged with reference ' || i.reference || '.');

  if pr is not null and cat <> 'other' then
    insert into public.incident_updates (incident_id, status, message) values (i.id, 'provider_notified', 'The transport provider has been notified.');
    perform private.notify('dashboard', 'provider', 'incident', 'Incident ' || i.reference || ' on ' || b.reference,
      replace(cat, '_', ' ') || case when urgent then ' · IMMEDIATE ASSISTANCE REQUESTED' else '' end, b.id, i.id, null, pr);
  end if;
  if h is not null then
    insert into public.incident_updates (incident_id, status, message) values
      (i.id, 'hotel_notified', 'Your hotel has been notified.'),
      (i.id, 'hotel_pending', 'Waiting for your hotel to respond.');
    perform private.notify('dashboard', 'hotel', 'incident', 'Incident ' || i.reference || coalesce(' · ' || b.reference, ''),
      replace(cat, '_', ' ') || case when urgent then ' · IMMEDIATE ASSISTANCE REQUESTED' else '' end, b.id, i.id, h);
  end if;
  if is_acc then
    insert into public.incident_updates (incident_id, status, message) values
      (i.id, null, 'Your accommodation report has been passed to the SafeArrival safety team for review.');
  end if;
  update public.incidents set status = case when h is not null then 'hotel_pending' when pr is not null then 'provider_notified' else 'received' end
   where id = i.id returning * into i;

  perform private.notify('dashboard', 'admin', 'incident', 'New ' || i.service || ' incident ' || i.reference,
    replace(cat, '_', ' ') || coalesce(' · ' || i.subject_name, ''), b.id, i.id);
  if b.id is not null then
    perform private.notify('whatsapp', 'tourist', 'incident_received', 'Report received',
      format(E'Your report has been received.\n\nReference: %s\n\n%sWe will keep you updated as your report progresses.%s',
        i.reference, case when h is not null then 'Your hotel has been notified. ' else '' end,
        case when urgent then E'\n\nIf you are in immediate danger call 10111 (police) or 112 from a mobile.' else '' end),
      b.id, i.id);
  end if;
  return jsonb_build_object('reference', i.reference, 'access_token', i.access_token, 'status', i.status);
end $$;

-- ================================================================ safety checks (lookups, no personal data)
create table public.safety_checks (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('accommodation', 'transport')),
  channel text not null check (channel in ('whatsapp', 'mcp')),
  outcome text not null check (outcome in ('verified_partner', 'not_approved', 'not_found', 'contact_mismatch')),
  hotel_id uuid references public.hotels (id) on delete set null,
  provider_id uuid references public.transport_providers (id) on delete set null,
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index safety_checks_created_idx on public.safety_checks (service, created_at desc);

-- ================================================================ visitor feedback (one service, both channels)
-- A row is created when feedback is OFFERED (server-issued random `ref`, so assistants cannot invent
-- interactions) and filled once when SUBMITTED (one submission per ref = duplicate prevention).
-- No phone numbers, names or wa_ids are stored: feedback is anonymous by design. It is kept apart
-- from incidents (a complaint here is not a report; the visitor is pointed to reporting instead).
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default encode(gen_random_bytes(16), 'hex'),   -- interaction reference
  service text not null check (service in ('accommodation', 'transport', 'incident', 'guidance')),
  channel text not null check (channel in ('whatsapp', 'mcp')),
  booking_id uuid references public.bookings (id) on delete set null,
  incident_id uuid references public.incidents (id) on delete set null,
  hotel_id uuid references public.hotels (id) on delete set null,          -- accommodation the feedback is about
  provider_id uuid references public.transport_providers (id) on delete set null,
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  overall_rating int check (overall_rating between 1 and 5),
  safety_rating int check (safety_rating between 1 and 5),               -- 1 very unsafe … 5 very safe (perception, not proof)
  helpful text check (helpful in ('yes', 'partly', 'no')),
  confident text check (confident in ('yes', 'partly', 'no')),
  use_again text check (use_again in ('yes', 'partly', 'no')),
  answers jsonb not null default '{}'::jsonb,                             -- context questions: {key: yes|partly|no}
  comment text check (char_length(comment) <= 1000),
  simulated boolean not null default false,                               -- demo/seeded rows, never mixed silently with real
  check (submitted_at is not null or (overall_rating is null and safety_rating is null and comment is null))
);
create index feedback_submitted_idx on public.feedback (submitted_at desc) where submitted_at is not null;
create index feedback_booking_idx on public.feedback (booking_id) where booking_id is not null;
create index feedback_incident_idx on public.feedback (incident_id) where incident_id is not null;

-- ================================================================ goals & targets (admin-configured)
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  category text not null check (category in ('accommodation', 'transport', 'overall')),
  kpi text not null check (kpi in ('accommodation_verification_rate', 'transport_verification_rate', 'incident_ack_minutes',
    'incident_followup_rate', 'avg_safety_rating', 'avg_overall_rating', 'confidence_rate', 'feedback_response_rate')),
  baseline numeric(10, 2) not null,
  target numeric(10, 2) not null check (target <> baseline),              -- target < baseline means "lower is better"
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger goals_touch before update on public.goals for each row execute function public.touch_updated_at();

alter table public.safety_checks enable row level security;
alter table public.feedback enable row level security;
alter table public.goals enable row level security;
create policy safety_checks_admin on public.safety_checks for select using (app.is_admin());
create policy feedback_admin on public.feedback for select using (app.is_admin());
create policy goals_admin on public.goals for select using (app.is_admin());
grant select on public.safety_checks, public.feedback, public.goals to authenticated;
revoke all on public.safety_checks, public.feedback, public.goals from anon;
revoke insert, update, delete, truncate on public.safety_checks, public.feedback, public.goals from authenticated;
-- `ref` is a credential (it lets someone submit): admins see aggregates and rows, never refs.
revoke select on public.feedback from authenticated;
grant select (id, service, channel, booking_id, incident_id, hotel_id, provider_id, requested_at, submitted_at, overall_rating,
  safety_rating, helpful, confident, use_again, answers, comment, simulated) on public.feedback to authenticated;

insert into public.app_settings (key, value) values
  ('feedback_retention', '{"unanswered_days": 30, "comment_days": 365}')
on conflict (key) do nothing;

-- ================================================================ feedback service
create or replace function private.feedback_questions(s text) returns jsonb
language sql immutable as $$
  select case s
    when 'transport' then '["driver_matched", "vehicle_matched", "pickup_safe", "price_respected", "journey_safe"]'
    when 'accommodation' then '["matched_description", "provider_consistent", "checkin_safe", "payment_clear", "felt_uncomfortable"]'
    when 'incident' then '["reporting_easy", "next_steps_clear", "received_update", "communication_ok"]'
    else '["easy_to_use", "safer_decision"]' end::jsonb
$$;

-- Offer feedback for a completed interaction. Returns null if this interaction was already rated.
-- Feedback about one booking/incident is offered once per channel; open offers are reused.
create or replace function private.offer_feedback(p_service text, p_channel text, p_booking uuid default null,
  p_incident uuid default null, p_hotel uuid default null, p_provider uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.feedback; ret jsonb := private.setting('feedback_retention', '{}');
begin
  -- Retention (cheap, runs with each offer): unanswered offers and old comments are removed.
  delete from public.feedback where submitted_at is null
    and requested_at < now() - make_interval(days => coalesce((ret ->> 'unanswered_days')::int, 30));
  update public.feedback set comment = null where comment is not null
    and submitted_at < now() - make_interval(days => coalesce((ret ->> 'comment_days')::int, 365));

  if p_booking is not null or p_incident is not null then
    select * into f from public.feedback where service = p_service and channel = p_channel
      and (booking_id = p_booking or incident_id = p_incident) order by requested_at desc limit 1;
    if f.submitted_at is not null then return null; end if;
  end if;
  if f.id is null then
    insert into public.feedback (service, channel, booking_id, incident_id, hotel_id, provider_id)
    values (p_service, p_channel, p_booking, p_incident, p_hotel, p_provider) returning * into f;
  end if;
  return jsonb_build_object('ref', f.ref, 'service', f.service, 'optional', true,
    'questions', jsonb_build_object(
      'overall_rating', '1-5 (1 = very poor, 5 = excellent)',
      'safety_rating', '1-5 perceived safety (1 very unsafe, 2 unsafe, 3 neutral, 4 safe, 5 very safe)',
      'helpful', 'yes | partly | no', 'confident', 'yes | partly | no (felt more confident after using SafeArrival)',
      'use_again', 'yes | partly | no', 'answers', private.feedback_questions(f.service), 'comment', 'optional, max 1000 characters'));
end $$;

-- WhatsApp channel entry point (webhook with the service role; also the in-browser simulator).
-- The booking/incident is identified by its private token, proving the caller took part.
create or replace function public.request_feedback(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s text := p ->> 'service'; b public.bookings; inc uuid; h uuid; pr uuid; out jsonb;
begin
  if s is null or s not in ('accommodation', 'transport', 'incident', 'guidance') then raise exception 'Unknown feedback type'; end if;
  -- ponytail: global cap against anonymous spam of open offers; per-number limits if abused.
  if (select count(*) from public.feedback where channel = 'whatsapp' and submitted_at is null and requested_at > now() - interval '1 hour') >= 500 then
    raise exception 'Feedback is busy right now. Please try again later.';
  end if;
  if nullif(p ->> 'booking_token', '') is not null and s = 'transport' then
    b := private.booking_by_token(p ->> 'booking_token'); pr := b.provider_id;
  end if;
  if nullif(p ->> 'incident_token', '') is not null and s = 'incident' then
    select id into inc from public.incidents where access_token = p ->> 'incident_token';
    if inc is null then raise exception 'Report not found'; end if;
  end if;
  if s = 'accommodation' then h := (select id from public.hotels where slug = p ->> 'hotel_slug'); end if;
  if s = 'transport' and pr is null then pr := (select id from public.transport_providers where id::text = p ->> 'provider_id'); end if;
  out := private.offer_feedback(s, 'whatsapp', b.id, inc, h, pr);
  return coalesce(out, jsonb_build_object('already_submitted', true));
end $$;

-- The one submission path for both channels. Validates everything; one submission per ref.
create or replace function public.submit_feedback(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f public.feedback; k text; v text; ans jsonb := coalesce(p -> 'answers', '{}'); allowed jsonb;
  c text := nullif(trim(regexp_replace(coalesce(p ->> 'comment', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  ov int; sf int;
begin
  select * into f from public.feedback where ref = p ->> 'ref' for update;
  if f.id is null or f.requested_at < now() - interval '30 days' then
    raise exception 'invalid:Unknown or expired feedback reference';
  end if;
  if f.submitted_at is not null then raise exception 'invalid:Feedback for this interaction was already submitted. Thank you!'; end if;
  if p ? 'channel' and p ->> 'channel' <> f.channel then raise exception 'invalid:Feedback reference belongs to another channel'; end if;

  begin
    ov := nullif(p ->> 'overall_rating', '')::int; sf := nullif(p ->> 'safety_rating', '')::int;
  exception when others then raise exception 'invalid:Ratings must be whole numbers from 1 to 5'; end;
  if ov not between 1 and 5 or sf not between 1 and 5 then raise exception 'invalid:Ratings must be whole numbers from 1 to 5'; end if;
  foreach k in array array['helpful', 'confident', 'use_again'] loop
    if p ->> k is not null and p ->> k not in ('yes', 'partly', 'no') then raise exception 'invalid:% must be yes, partly or no', k; end if;
  end loop;
  if jsonb_typeof(ans) <> 'object' then raise exception 'invalid:answers must be an object'; end if;
  allowed := private.feedback_questions(f.service);
  for k, v in select key, value from jsonb_each_text(ans) loop
    if not allowed ? k then raise exception 'invalid:Unknown question % for % feedback', k, f.service; end if;
    if v not in ('yes', 'partly', 'no') then raise exception 'invalid:Answer to % must be yes, partly or no', k; end if;
  end loop;
  if char_length(c) > 1000 then raise exception 'invalid:Comment is too long (1000 characters max)'; end if;
  if ov is null and sf is null and p ->> 'helpful' is null and p ->> 'confident' is null and p ->> 'use_again' is null
     and ans = '{}'::jsonb and c is null then
    raise exception 'invalid:Nothing to submit';
  end if;

  update public.feedback set submitted_at = now(), overall_rating = ov, safety_rating = sf,
    helpful = p ->> 'helpful', confident = p ->> 'confident', use_again = p ->> 'use_again', answers = ans, comment = c
  where id = f.id;
  return jsonb_build_object('submitted', true, 'service', f.service,
    'message', 'Thank you. Your feedback is anonymous and helps improve visitor safety.',
    'note', 'Feedback is not an incident report. To report a safety problem, use the report option; in an emergency call 10111 or 112.');
end $$;

-- ================================================================ lookups shared by both channels
create or replace function private.accommodation_lookup(a jsonb, p_channel text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  q text := trim(coalesce(a ->> 'name', '')); given text := right(regexp_replace(coalesce(a ->> 'phone', ''), '\D', '', 'g'), 9);
  out jsonb; outcome text; top public.hotels; fb jsonb;
begin
  if char_length(q) < 3 then raise exception 'invalid:Give at least 3 characters of the accommodation name'; end if;
  if char_length(q) > 120 then raise exception 'invalid:Name is too long'; end if;
  if given <> '' and char_length(given) < 7 then raise exception 'invalid:That phone number looks too short'; end if;
  q := replace(replace(q, '%', ''), '_', '');

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', h.name, 'slug', h.slug, 'area', h.area,
      'safearrival_status', case h.status when 'active' then 'approved_partner' when 'pending' then 'under_review_not_approved' else 'suspended' end,
      'meaning', case h.status
        when 'active' then 'SafeArrival partner accommodation: its identity and official contact details are on record with SafeArrival.'
        when 'pending' then 'Known to SafeArrival but NOT yet approved. Contact details are not confirmed.'
        else 'SafeArrival partnership is suspended.' end,
      'official_contacts', case when h.status = 'active' then jsonb_build_object('address', h.address, 'phone', h.phone, 'email', h.email) end,
      'contact_check', case when given = '' then 'not_checked' when h.status <> 'active' or h.phone is null then 'no_official_number_on_record'
                            when right(regexp_replace(h.phone, '\D', '', 'g'), 9) = given then 'match' else 'mismatch' end,
      'verified_reports_90_days', (select count(*) from public.incidents i where i.subject_hotel_id = h.id
          and i.verification_status in ('verified', 'official_advisory') and i.created_at > now() - interval '90 days'),
      'status_last_changed', h.updated_at) order by h.status = 'active' desc, h.name), '[]') into out
  from (select * from public.hotels where name ilike '%' || q || '%' or slug = lower(q) order by status = 'active' desc, name limit 5) h;

  select * into top from public.hotels where name ilike '%' || q || '%' or slug = lower(q) order by status = 'active' desc, name limit 1;
  outcome := case when top.id is null then 'not_found'
                  when exists (select 1 from jsonb_array_elements(out) e where e ->> 'contact_check' = 'mismatch') then 'contact_mismatch'
                  when top.status = 'active' then 'verified_partner' else 'not_approved' end;
  insert into public.safety_checks (service, channel, outcome, hotel_id) values ('accommodation', p_channel, outcome, top.id);
  if p_channel = 'mcp' then fb := private.offer_feedback('accommodation', 'mcp', null, null, top.id); end if;

  return jsonb_build_object('query', jsonb_build_object('name', q, 'phone_checked', given <> ''),
    'result', case outcome when 'not_found' then 'not_in_safearrival_records' else outcome end,
    'matches', out,
    'warnings', to_jsonb(array_remove(array[
      case when outcome = 'contact_mismatch' then 'The phone number you were given does NOT match the official number SafeArrival holds. Do not send money or personal details to it; contact the accommodation on its official number first.' end,
      case when outcome = 'not_found' then 'SafeArrival has no record of this accommodation. That does NOT mean it is illegitimate; SafeArrival simply has not verified it. Check it on the booking platform.' end], null)),
    'guidance', jsonb_build_array(
      'Pay only through the booking platform or the accommodation''s official channel; be wary of bank transfers to personal accounts.',
      'Confirm the address and phone number from the official website or booking platform, not from a message you received.',
      'Urgent pressure ("pay now or lose the room") and requests to move the conversation off the platform are common scam signs.'),
    'limitations', jsonb_build_array('Partner status shows that SafeArrival holds verified contact details; it is not a guarantee of safety or quality.'),
    'feedback', fb,
    'checked_at', now(), 'data_notice', private.demo_notice());
end $$;

create or replace function public.check_accommodation(p jsonb) returns jsonb
language sql security definer set search_path = public, extensions as $$ select private.accommodation_lookup(p, 'whatsapp') $$;

-- Provider check: keep the MCP tool body (migration 6) and add the check log around it.
alter function private.tool_verify_transport_provider(jsonb) rename to verify_provider_core;
create or replace function private.provider_lookup(a jsonb, p_channel text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb := private.verify_provider_core(a); m jsonb := r -> 'matches' -> 0;
begin
  insert into public.safety_checks (service, channel, outcome, provider_id)
  values ('transport', p_channel, case when m is null then 'not_found' when m ->> 'safearrival_status' = 'approved_partner' then 'verified_partner' else 'not_approved' end,
    (m ->> 'provider_id')::uuid);
  return r;
end $$;
create or replace function private.tool_verify_transport_provider(a jsonb) returns jsonb
language sql security definer set search_path = public, extensions as $$ select private.provider_lookup(a, 'mcp') $$;
create or replace function public.check_transport_provider(p jsonb) returns jsonb
language sql security definer set search_path = public, extensions as $$ select private.provider_lookup(p, 'whatsapp') $$;

-- Approved guidance for before / during / after a visit, from the curated safety_advice table.
alter table public.safety_advice drop constraint safety_advice_context_check;
alter table public.safety_advice add constraint safety_advice_context_check check (context in (
  'general', 'airport_arrival', 'ehailing', 'shuttle', 'night', 'outdoors', 'emergency', 'accommodation', 'after_incident'));
alter table public.safety_advice
  add column stage text check (stage in ('before_arrival', 'during_visit', 'after_incident')),
  add column service text not null default 'any' check (service in ('accommodation', 'transport', 'any'));
update public.safety_advice set stage = case
    when id in ('g-share', 's-confirm', 'a-touts') then 'before_arrival'
    when id in ('g-report', 'x-emergency') then 'after_incident' else 'during_visit' end,
  service = case when id in ('g-share', 'g-report', 'x-emergency', 'o-hike', 'n-wait') then 'any' else 'transport' end;
insert into public.safety_advice (id, context, title, advice, stage, service) values
  ('acc-check', 'accommodation', 'Check the accommodation before you pay', 'Compare the listing''s address, photos and contact details with the booking platform and the accommodation''s official website. Ask SafeArrival to check whether it is a partner.', 'before_arrival', 'accommodation'),
  ('acc-pay', 'accommodation', 'Suspicious booking requests', 'Be wary of requests to pay by bank transfer to a personal account, to pay outside the booking platform, or to pay immediately to "hold" a room. Legitimate providers do not mind you confirming first.', 'before_arrival', 'accommodation'),
  ('acc-transport', 'accommodation', 'Confirm your transport arrangements', 'Arrange your airport pickup before you travel, and keep the driver, vehicle and price details from a trusted channel. SafeArrival bookings give you a code the driver must say first.', 'before_arrival', 'transport'),
  ('acc-checkin', 'accommodation', 'At check-in', 'Check that the address and the person checking you in match your booking. If you are asked for an unexpected cash payment or a new deposit, confirm with the booking platform first.', 'during_visit', 'accommodation'),
  ('acc-payment-change', 'accommodation', 'Changed payment details', 'A message saying the bank account has "changed" is a common scam. Confirm any new payment details by phoning the accommodation''s official number.', 'during_visit', 'accommodation'),
  ('inc-report', 'after_incident', 'Report it', 'Report what happened to SafeArrival (WhatsApp "Something''s wrong" or your AI assistant). You receive a reference so you can check updates. A SafeArrival reference is not a police case number.', 'after_incident', 'any'),
  ('inc-police', 'after_incident', 'Crimes and emergencies', 'For crimes, open a case at a SAPS police station and keep the case number. In an emergency call 10111 (police), 10177 (ambulance) or 112 from a mobile.', 'after_incident', 'any'),
  ('inc-evidence', 'after_incident', 'Keep your records', 'Keep booking confirmations, payment receipts, messages and photos of number plates. Do not confront the person involved.', 'after_incident', 'any')
on conflict (id) do nothing;

create or replace function public.safety_guidance(p_stage text, p_service text default 'any') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if p_stage not in ('before_arrival', 'during_visit', 'after_incident') then raise exception 'invalid:stage must be before_arrival, during_visit or after_incident'; end if;
  if coalesce(p_service, 'any') not in ('accommodation', 'transport', 'any') then raise exception 'invalid:service must be accommodation, transport or any'; end if;
  return jsonb_build_object('stage', p_stage, 'service', coalesce(p_service, 'any'),
    'advice', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'advice', advice, 'applies_to', service, 'updated_at', updated_at)
                 order by service = 'any', id), '[]')
               from public.safety_advice where stage = p_stage and (coalesce(p_service, 'any') = 'any' or service in (p_service, 'any'))),
    'emergency', jsonb_build_object('police', '10111', 'ambulance', '10177', 'mobile_emergency', '112',
      'note', 'SafeArrival is not an emergency service.'),
    'source', 'Curated SafeArrival guidance (approved content only).');
end $$;

-- ================================================================ MCP tools (found by name by mcp_call, migration 7)
create or replace function private.tool_check_accommodation(a jsonb) returns jsonb
language sql security definer set search_path = public, extensions as $$ select private.accommodation_lookup(a, 'mcp') $$;

create or replace function private.tool_get_safety_guidance(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not private.dataset_on('safety_advice') then raise exception 'disabled:safety_advice'; end if;
  return public.safety_guidance(coalesce(nullif(a ->> 'stage', ''), 'before_arrival'), coalesce(nullif(a ->> 'service', ''), 'any'))
    || jsonb_build_object('feedback', private.offer_feedback('guidance', 'mcp'));
end $$;

-- Status of the caller's own report (they hold its tracking token). No description, no names.
create or replace function private.tool_get_incident_status(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare i public.incidents; tok text := a ->> 'tracking_token';
begin
  if tok is null or tok !~ '^[0-9a-f]{20,64}$' then raise exception 'invalid:tracking_token is the private code returned when the report was submitted'; end if;
  select * into i from public.incidents where access_token = tok;
  if i.id is null then raise exception 'not_found:No report matches that tracking token'; end if;
  return jsonb_build_object('reference', i.reference, 'service', i.service, 'category', i.category, 'category_label', private.category_label(i.category),
    'status', i.status,
    'status_meaning', case when i.status in ('resolved', 'closed') then 'The handling team has marked this report ' || i.status || '.'
                           else 'Open: the report is still being handled. Do not describe it as resolved.' end,
    'verification_status', i.verification_status, 'reported_at', i.created_at, 'last_updated', i.updated_at,
    'updates', coalesce((select jsonb_agg(jsonb_build_object('status', u.status, 'message', u.message, 'at', u.created_at) order by u.created_at)
                from public.incident_updates u where u.incident_id = i.id and u.visibility = 'public'), '[]'),
    'note', 'This is a SafeArrival reference, not a police case number. In an emergency call 10111 or 112.',
    'feedback', case when exists (select 1 from public.incident_updates u where u.incident_id = i.id and u.visibility = 'public' and u.author_label <> 'System')
                     then private.offer_feedback('incident', 'mcp', null, i.id) end);
end $$;

create or replace function private.tool_submit_feedback(a jsonb) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select public.submit_feedback(a || jsonb_build_object('channel', 'mcp'))
$$;

-- verify_driver: same checks, plus a transport feedback offer once a check was made.
alter function private.tool_verify_driver(jsonb) rename to verify_driver_core;
create or replace function private.tool_verify_driver(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb := private.verify_driver_core(a); b public.bookings;
begin
  if (r ->> 'can_verify')::boolean and r -> 'checks' ->> 'spoken_code' <> 'not_checked' then
    b := private.booking_by_token(a ->> 'booking_token');
    r := r || jsonb_build_object('feedback', private.offer_feedback('transport', 'mcp', b.id, null, null, b.provider_id));
  end if;
  return r;
end $$;

-- report_safety_incident: accommodation categories and the name of what is reported, plus an incident feedback offer.
alter function private.tool_report_safety_incident(jsonb) rename to report_incident_core;
create or replace function private.tool_report_safety_incident(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; nm text := nullif(left(trim(a ->> 'subject_name'), 120), ''); i public.incidents;
begin
  r := private.report_incident_core(a);
  update public.incidents set subject_name = nm,
    subject_hotel_id = case when service = 'accommodation' and nm is not null
      then (select id from public.hotels where name ilike nm or slug = lower(nm) limit 1) end
  where reference = r ->> 'reference' returning * into i;
  return r || jsonb_build_object('service', i.service,
    'feedback', case when not coalesce((a ->> 'urgent')::boolean, false) then private.offer_feedback('incident', 'mcp', null, i.id) end);
end $$;

-- ================================================================ admin: analytics, feedback reports, goals
create or replace function private.pct(n numeric, d numeric) returns numeric
language sql immutable as $$ select case when coalesce(d, 0) = 0 then null else round(100 * n / d, 1) end $$;

create or replace function public.admin_safety_analytics(p_days int default 90) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)));
begin
  perform private.require_admin();
  return (with inc as (select * from public.incidents where created_at >= since and verification_status <> 'rejected'),
              chk as (select * from public.safety_checks where created_at >= since),
              att as (select a.* from public.verification_attempts a where a.created_at >= since)
  select jsonb_build_object(
    'period_days', p_days, 'generated_at', now(),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'outcome', outcome, 'count', n, 'simulated', s)), '[]')
               from (select service, outcome, count(*) n, count(*) filter (where simulated) s from chk group by 1, 2) x),
    'transport_verification', (select jsonb_build_object(
        'by_outcome', coalesce(jsonb_object_agg(outcome, n), '{}'),
        'rate', private.pct(sum(n) filter (where outcome = 'verified'), sum(n) filter (where outcome in ('verified', 'code_mismatch', 'details_mismatch', 'wrong_vehicle', 'cannot_find')))
      ) from (select outcome, count(*) n from att group by 1) x),
    'incidents_by_category', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'category', category,
        'label', private.category_label(category), 'count', n, 'verified', v) order by n desc), '[]')
      from (select service, category, count(*) n, count(*) filter (where verification_status in ('verified', 'official_advisory')) v from inc group by 1, 2) x),
    'repeated_subjects', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'name', nm, 'count', n,
        'categories', cats, 'latest', latest) order by n desc), '[]')
      from (select i.service, coalesce(h.name, p.name, initcap(lower(i.subject_name))) nm, count(*) n,
                   jsonb_agg(distinct i.category) cats, max(i.created_at) latest
            from inc i left join public.hotels h on h.id = i.subject_hotel_id
            left join public.transport_providers p on p.id = i.provider_id and i.service = 'transport'
            where coalesce(h.name, p.name, i.subject_name) is not null
            group by 1, 2 having count(*) >= 2) x),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'location', loc, 'count', n) order by n desc), '[]')
      from (select i.service, coalesce(pp.name, h.area, i.location_text, 'Unknown') loc, count(*) n
            from inc i left join public.pickup_points pp on pp.id = i.pickup_point_id left join public.hotels h on h.id = i.subject_hotel_id
            group by 1, 2) x),
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(w, 'DD Mon'), 'transport', t, 'accommodation', a) order by w), '[]')
      from (select g w, count(*) filter (where inc.service = 'transport') t, count(*) filter (where inc.service = 'accommodation') a
            from generate_series(date_trunc('week', since), date_trunc('week', now()), interval '1 week') g
            left join inc on date_trunc('week', inc.created_at) = g group by g) x)));
end $$;

create or replace function public.admin_feedback_report(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  svc text := nullif(p ->> 'service', ''); ch text := nullif(p ->> 'channel', '');
  d_from timestamptz := coalesce(nullif(p ->> 'from', '')::date, current_date - 90);
  d_to timestamptz := coalesce(nullif(p ->> 'to', '')::date, current_date) + interval '1 day';
  rmin int := coalesce(nullif(p ->> 'min_rating', '')::int, 1); rmax int := coalesce(nullif(p ->> 'max_rating', '')::int, 5);
  prov uuid := nullif(p ->> 'provider_id', '')::uuid; hot uuid := nullif(p ->> 'hotel_id', '')::uuid;
  sim text := coalesce(nullif(p ->> 'data', ''), 'all');   -- all | real | simulated
begin
  perform private.require_admin();
  if sim not in ('all', 'real', 'simulated') then raise exception 'data must be all, real or simulated'; end if;
  return (with base as (
      select f.*, h.name hotel_name, pr.name provider_name from public.feedback f
      left join public.hotels h on h.id = f.hotel_id left join public.transport_providers pr on pr.id = f.provider_id
      where f.requested_at >= d_from and f.requested_at < d_to and (svc is null or f.service = svc) and (ch is null or f.channel = ch)
        and (prov is null or f.provider_id = prov) and (hot is null or f.hotel_id = hot)
        and (sim = 'all' or f.simulated = (sim = 'simulated'))),
    sub as (select * from base where submitted_at is not null
        and (overall_rating is null and rmin = 1 and rmax = 5 or coalesce(overall_rating, safety_rating) between rmin and rmax)),
    neg as (select * from sub where overall_rating <= 2 or safety_rating <= 2 or helpful = 'no'
        or exists (select 1 from jsonb_each_text(answers) e where e.value = 'no' and e.key <> 'felt_uncomfortable')
        or answers ->> 'felt_uncomfortable' = 'yes')
  select jsonb_build_object(
    'filters', jsonb_build_object('service', svc, 'channel', ch, 'from', d_from::date, 'to', (d_to - interval '1 day')::date,
      'min_rating', rmin, 'max_rating', rmax, 'data', sim),
    'summary', (select jsonb_build_object(
        'offered', (select count(*) from base), 'submitted', count(*),
        'response_rate', private.pct(count(*), (select count(*) from base)),
        'avg_overall', round(avg(overall_rating), 2), 'avg_safety', round(avg(safety_rating), 2),
        'helpful_pct', private.pct(count(*) filter (where helpful = 'yes'), count(helpful)),
        'confident_pct', private.pct(count(*) filter (where confident = 'yes'), count(confident)),
        'use_again_pct', private.pct(count(*) filter (where use_again = 'yes'), count(use_again)),
        'negative', (select count(*) from neg), 'with_comment', count(comment),
        'simulated', count(*) filter (where simulated), 'real', count(*) filter (where not simulated)) from sub),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'submitted', n, 'avg_overall', ao, 'avg_safety', asf,
        'confident_pct', cp) order by service), '[]')
      from (select service, count(*) n, round(avg(overall_rating), 2) ao, round(avg(safety_rating), 2) asf,
                   private.pct(count(*) filter (where confident = 'yes'), count(confident)) cp from sub group by 1) x),
    'by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'offered', o, 'submitted', s, 'response_rate', private.pct(s, o))), '[]')
      from (select channel, count(*) o, count(submitted_at) s from base group by 1) x),
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(w, 'DD Mon'), 'submitted', n, 'avg_overall', ao, 'avg_safety', asf, 'negative', ng) order by w), '[]')
      from (select date_trunc('week', submitted_at) w, count(*) n, round(avg(overall_rating), 2) ao, round(avg(safety_rating), 2) asf,
                   count(*) filter (where id in (select id from neg)) ng from sub group by 1) x),
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'question', k, 'yes', y, 'partly', pa, 'no', no_) order by service, k), '[]')
      from (select service, e.key k, count(*) filter (where e.value = 'yes') y, count(*) filter (where e.value = 'partly') pa,
                   count(*) filter (where e.value = 'no') no_ from sub, jsonb_each_text(answers) e group by 1, 2) x),
    'recurring', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'subject', subject, 'negative', n, 'issues', issues) order by n desc), '[]')
      from (select service, subject, count(distinct id) n, coalesce(jsonb_agg(distinct k) filter (where k is not null), '[]') issues
            from (select neg.id, neg.service, coalesce(neg.hotel_name, neg.provider_name, 'Unattributed') subject, e.key k
                  from neg left join lateral (select key from jsonb_each_text(neg.answers)
                    where value = 'no' or (key = 'felt_uncomfortable' and value = 'yes')) e on true) y
            group by 1, 2 having count(distinct id) >= 2) x),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'submitted_at', submitted_at, 'service', service, 'channel', channel,
        'overall_rating', overall_rating, 'safety_rating', safety_rating, 'helpful', helpful, 'confident', confident, 'use_again', use_again,
        'answers', answers, 'comment', comment, 'subject', coalesce(hotel_name, provider_name), 'simulated', simulated) order by submitted_at desc), '[]')
      from (select * from sub order by submitted_at desc limit 500) x)));
end $$;

create or replace function public.log_feedback_export(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  perform private.audit('export_feedback', 'feedback', null, jsonb_build_object('filters', p));
end $$;

-- Live KPI value for a period. Every KPI is computed here (database), never in the browser.
create or replace function private.kpi_value(p_kpi text, p_category text, p_from timestamptz, p_to timestamptz, p_sim boolean) returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  svc text := case when p_category = 'overall' then null else p_category end;
  fb_svc text[] := case p_category when 'accommodation' then array['accommodation'] when 'transport' then array['transport'] else null end;
begin
  return case p_kpi
    when 'accommodation_verification_rate' then (select private.pct(count(*) filter (where outcome = 'verified_partner'), count(*))
        from public.safety_checks where service = 'accommodation' and created_at >= p_from and created_at < p_to and (p_sim or not simulated))
    when 'transport_verification_rate' then (select private.pct(count(*) filter (where outcome = 'verified'), count(*))
        from public.verification_attempts where outcome in ('verified', 'code_mismatch', 'details_mismatch', 'wrong_vehicle', 'cannot_find')
          and created_at >= p_from and created_at < p_to)
    when 'incident_ack_minutes' then (select round(avg(extract(epoch from ack - created_at) / 60)::numeric, 1) from (
        select i.created_at, (select min(u.created_at) from public.incident_updates u where u.incident_id = i.id and u.author_label <> 'System') ack
        from public.incidents i where i.created_at >= p_from and i.created_at < p_to and (svc is null or i.service = svc)) x where ack is not null)
    when 'incident_followup_rate' then (select private.pct(count(*) filter (where exists (select 1 from public.incident_updates u
          where u.incident_id = i.id and u.visibility = 'public' and u.author_label <> 'System')), count(*))
        from public.incidents i where i.created_at >= p_from and i.created_at < p_to and (svc is null or i.service = svc))
    when 'avg_safety_rating' then (select round(avg(safety_rating), 2) from public.feedback where submitted_at >= p_from and submitted_at < p_to
        and (fb_svc is null or service = any (fb_svc)) and (p_sim or not simulated))
    when 'avg_overall_rating' then (select round(avg(overall_rating), 2) from public.feedback where submitted_at >= p_from and submitted_at < p_to
        and (fb_svc is null or service = any (fb_svc)) and (p_sim or not simulated))
    when 'confidence_rate' then (select private.pct(count(*) filter (where confident = 'yes'), count(confident)) from public.feedback
        where submitted_at >= p_from and submitted_at < p_to and (fb_svc is null or service = any (fb_svc)) and (p_sim or not simulated))
    when 'feedback_response_rate' then (select private.pct(count(submitted_at), count(*)) from public.feedback
        where requested_at >= p_from and requested_at < p_to and (fb_svc is null or service = any (fb_svc)) and (p_sim or not simulated))
  end;
end $$;

create or replace function private.goal_json(g public.goals, p_sim boolean) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  cur numeric := private.kpi_value(g.kpi, g.category, g.period_start::timestamptz, (least(g.period_end, current_date) + 1)::timestamptz, p_sim);
  progress numeric := case when cur is not null then round(100 * (cur - g.baseline) / (g.target - g.baseline), 1) end;
  elapsed numeric := round(100 * greatest(0, least(1, (current_date - g.period_start + 1)::numeric / (g.period_end - g.period_start + 1))), 1);
begin
  return to_jsonb(g) || jsonb_build_object('current', cur, 'progress_pct', progress, 'elapsed_pct', elapsed,
    'lower_is_better', g.target < g.baseline,
    'status', case when current_date < g.period_start then 'not_started'
                   when cur is null then 'no_data'
                   when progress >= 100 then 'achieved'
                   when current_date > g.period_end then 'missed'
                   when progress >= elapsed * 0.8 then 'on_track' else 'at_risk' end);
end $$;

create or replace function public.admin_goals(p_include_simulated boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  return jsonb_build_object('include_simulated', p_include_simulated, 'generated_at', now(),
    'goals', (select coalesce(jsonb_agg(private.goal_json(g, coalesce(p_include_simulated, false)) order by g.category, g.name), '[]') from public.goals g));
end $$;

create or replace function public.save_goal(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare gid uuid := nullif(p ->> 'id', '')::uuid; g public.goals;
begin
  perform private.require_admin();
  if p ->> 'baseline' !~ '^-?[0-9]+(\.[0-9]+)?$' or p ->> 'target' !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Baseline and target must be numbers'; end if;
  if gid is null then
    insert into public.goals (name, category, kpi, baseline, target, period_start, period_end, notes)
    values (trim(p ->> 'name'), p ->> 'category', p ->> 'kpi', (p ->> 'baseline')::numeric, (p ->> 'target')::numeric,
      (p ->> 'period_start')::date, (p ->> 'period_end')::date, nullif(trim(p ->> 'notes'), '')) returning * into g;
  else
    update public.goals set name = trim(p ->> 'name'), category = p ->> 'category', kpi = p ->> 'kpi',
      baseline = (p ->> 'baseline')::numeric, target = (p ->> 'target')::numeric, period_start = (p ->> 'period_start')::date,
      period_end = (p ->> 'period_end')::date, notes = nullif(trim(p ->> 'notes'), '') where id = gid returning * into g;
    if g.id is null then raise exception 'Goal not found'; end if;
  end if;
  perform private.audit(case when gid is null then 'create_goal' else 'update_goal' end, 'goal', g.id,
    jsonb_build_object('name', g.name, 'kpi', g.kpi, 'baseline', g.baseline, 'target', g.target, 'period', g.period_start || '…' || g.period_end));
  return g.id;
exception when check_violation then raise exception 'Check the goal: name 3–120 characters, a known KPI and category, target different from baseline, end date after start';
end $$;

create or replace function public.delete_goal(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare g public.goals;
begin
  perform private.require_admin();
  delete from public.goals where id = p_id returning * into g;
  if g.id is null then raise exception 'Goal not found'; end if;
  perform private.audit('delete_goal', 'goal', p_id, jsonb_build_object('name', g.name));
end $$;

-- Starting goals (editable; targets are configuration, not code).
insert into public.goals (name, category, kpi, baseline, target, period_start, period_end, notes)
select * from (values
  ('Raise transport verification rate', 'transport', 'transport_verification_rate', 80.0, 95.0, date_trunc('quarter', now())::date, (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date, 'Share of pickups where the driver passed verification.'),
  ('Raise accommodation verification rate', 'accommodation', 'accommodation_verification_rate', 50.0, 70.0, date_trunc('quarter', now())::date, (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date, null),
  ('Acknowledge incidents faster', 'overall', 'incident_ack_minutes', 60.0, 20.0, date_trunc('quarter', now())::date, (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date, 'Minutes from report to first human response.'),
  ('Visitors feel safe', 'overall', 'avg_safety_rating', 3.5, 4.3, date_trunc('quarter', now())::date, (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date, 'Perceived safety (1–5). A perception indicator, not proof of safety.'),
  ('More confident visitors', 'overall', 'confidence_rate', 60.0, 80.0, date_trunc('quarter', now())::date, (date_trunc('quarter', now()) + interval '3 months' - interval '1 day')::date, null)
) v where not exists (select 1 from public.goals);

-- ================================================================ demo data (simulated, flagged)
alter function private.seed_demo_data() rename to seed_demo_v6;
create or replace function private.seed_demo_data() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i int; svc text; h uuid; pr uuid; ts timestamptz; ok boolean;
begin
  perform private.seed_demo_v6();
  -- A few fictional accommodation reports, so accommodation analytics have something to show.
  insert into public.incidents (reference, category, description, status, subject_hotel_id, subject_name, location_text, created_at, updated_at)
  select 'SAFE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.incident_ref_seq')::text, 4, '0'), c, d, st,
    (select id from public.hotels where slug = hs), nm, loc, now() - make_interval(days => dd), now() - make_interval(days => dd)
  from (values
    ('booking_payment_fraud', 'Got a message asking me to pay the deposit again to a "new" bank account.', 'follow_up', null, 'Ocean Breeze Apartments', 'Sea Point', 6),
    ('booking_payment_fraud', 'Listing asked for full payment by bank transfer outside the platform.', 'received', null, 'Ocean Breeze Apartments', 'Sea Point', 12),
    ('listing_mismatch', 'Address on arrival was different from the listing photos.', 'resolved', null, 'Kloof Nek Lofts', 'City Bowl', 20),
    ('host_identity_mismatch', 'The phone number in my booking message did not match the hotel website.', 'follow_up', 'hotel-002', 'Quayside Grand Hotel', 'V&A Waterfront', 9),
    ('accommodation_unsafe', 'Felt unsafe at a late check-in; nobody at reception.', 'received', null, 'Kloof Nek Lofts', 'City Bowl', 3)
  ) v(c, d, st, hs, nm, loc, dd);
  insert into public.incident_updates (incident_id, status, message, created_at)
  select id, 'received', 'Your report has been received and logged.', created_at from public.incidents where service = 'accommodation';
  insert into public.incident_updates (incident_id, status, message, author_label, created_at)
  select id, 'follow_up', 'The safety team contacted the guest.', 'Safety team', created_at + interval '40 minutes'
  from public.incidents where service = 'accommodation' and status in ('follow_up', 'resolved');

  -- Simulated lookups and feedback over the last 60 days (deterministic, flagged simulated).
  for i in 1..60 loop
    ts := now() - make_interval(days => (i * 7) % 60, hours => i % 11);
    insert into public.safety_checks (service, channel, outcome, hotel_id, provider_id, simulated, created_at)
    values (case when i % 2 = 0 then 'accommodation' else 'transport' end, case when i % 3 = 0 then 'mcp' else 'whatsapp' end,
      case when i % 7 = 0 then 'not_found' when i % 22 = 0 then 'contact_mismatch' when i % 5 = 0 then 'not_approved' else 'verified_partner' end,
      case when i % 2 = 0 and i % 7 <> 0 then (select id from public.hotels order by slug offset (i % 3) limit 1) end,
      case when i % 2 = 1 and i % 7 <> 0 then (select id from public.transport_providers where status = 'active' order by name offset (i % 4) limit 1) end,
      true, ts);
  end loop;
  for i in 1..48 loop
    svc := (array['transport', 'accommodation', 'incident', 'guidance'])[1 + i % 4];
    h := case when svc = 'accommodation' then (select id from public.hotels where status = 'active' order by slug offset (i % 3) limit 1) end;
    pr := case when svc = 'transport' then (select id from public.transport_providers where status = 'active' order by name offset (i % 3) limit 1) end;
    ts := now() - make_interval(days => (i * 5) % 60, hours => i % 13);
    ok := i % 8 not in (1, 4);   -- about one in four experiences is negative, clustered so recurring complaints show
    insert into public.feedback (service, channel, hotel_id, provider_id, requested_at, submitted_at, overall_rating, safety_rating,
      helpful, confident, use_again, answers, comment, simulated)
    values (svc, case when i % 3 = 0 then 'mcp' else 'whatsapp' end, h, pr, ts,
      case when i % 5 <> 0 then ts + interval '3 minutes' end,
      case when i % 5 <> 0 then case when ok then 4 + i % 2 else 2 end end,
      case when i % 5 <> 0 and svc in ('transport', 'accommodation') then case when ok then 3 + i % 3 else 2 end end,
      case when i % 5 <> 0 then case when ok then 'yes' when i % 2 = 0 then 'partly' else 'no' end end,
      case when i % 5 <> 0 then case when ok and i % 4 <> 1 then 'yes' else 'partly' end end,
      case when i % 5 <> 0 and i % 2 = 0 then case when ok then 'yes' else 'no' end end,
      case when i % 5 = 0 then '{}'::jsonb
           when svc = 'transport' then jsonb_build_object('driver_matched', case when ok then 'yes' else 'no' end, 'price_respected', case when ok then 'yes' else 'no' end)
           when svc = 'accommodation' then jsonb_build_object('matched_description', case when ok then 'yes' else 'no' end, 'payment_clear', case when ok then 'yes' else 'partly' end)
           when svc = 'incident' then jsonb_build_object('next_steps_clear', case when ok then 'yes' else 'no' end)
           else jsonb_build_object('easy_to_use', 'yes') end,
      case when i % 5 <> 0 and not ok then (array['Driver asked for an extra cash fee at the airport.', 'Payment instructions changed after booking.',
             'Took a while to hear back.'])[1 + i % 3]
           when i % 5 <> 0 and i % 6 = 0 then 'Code check made me feel much calmer.' end,
      true);
  end loop;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
-- Admin-only RPCs: no anonymous EXECUTE (as migration 10).
revoke execute on function public.admin_safety_analytics(int), public.admin_feedback_report(jsonb), public.log_feedback_export(jsonb),
  public.admin_goals(boolean), public.save_goal(jsonb), public.delete_goal(uuid) from public, anon;
grant execute on function public.admin_safety_analytics(int), public.admin_feedback_report(jsonb), public.log_feedback_export(jsonb),
  public.admin_goals(boolean), public.save_goal(jsonb), public.delete_goal(uuid) to authenticated;
