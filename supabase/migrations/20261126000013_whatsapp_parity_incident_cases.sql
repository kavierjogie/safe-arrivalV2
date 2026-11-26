-- 13  WhatsApp ⇄ MCP parity, and structured incident case management.
--
-- Parity: the MCP tools (private.tool_*) become reachable from WhatsApp through ONE runner,
-- private.run_tool, shared with mcp_call. Same functions, same validation, same rate limits,
-- same logging (mcp_requests, client_name 'whatsapp'). WhatsApp keeps no copy of any check.
--
-- Cases: incidents gain an operational priority, a fuller lifecycle, a visitor contact for
-- updates (written only by the webhook), idempotent submission, visitor follow-ups and
-- admin actions (priority, escalation destination, resolution). Existing statuses are kept.

-- ================================================================ 1. one tool runner, two entry points
create or replace function private.run_tool(p_tool text, p_args jsonb, p_client text, p_client_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t0 timestamptz := clock_timestamp(); res jsonb; st text := 'ok'; err text; code text;
  is_write boolean := p_tool in ('report_safety_incident', 'subscribe_safety_alerts');
  lim int; win interval; hits int; a jsonb := coalesce(p_args, '{}');
begin
  if p_tool !~ '^[a-z_]{3,40}$' or to_regprocedure(format('private.%I(jsonb)', 'tool_' || p_tool)) is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Unknown tool');
  end if;

  lim := case when is_write then 3 else 60 end;
  win := case when is_write then interval '1 hour' else interval '1 minute' end;
  insert into private.mcp_rate (client, bucket, window_start)
  values (coalesce(left(p_client, 64), 'unknown'), case when is_write then 'write' else 'read' end,
          to_timestamp(floor(extract(epoch from now()) / extract(epoch from win)) * extract(epoch from win)))
  on conflict (client, bucket, window_start) do update set hits = private.mcp_rate.hits + 1
  returning private.mcp_rate.hits into hits;
  delete from private.mcp_rate where window_start < now() - interval '2 hours';
  if hits > lim then
    insert into public.mcp_requests (tool, status, client_name) values (p_tool, 'rate_limited', left(p_client_name, 60));
    return jsonb_build_object('ok', false, 'code', 'rate_limited',
      'error', format('Rate limit reached (%s %s). Please wait and try again. In an emergency call 10111 or 112.', lim, case when is_write then 'submissions per hour' else 'requests per minute' end));
  end if;

  begin
    execute format('select private.%I($1)', 'tool_' || p_tool) into res using a;
    if res is null then raise exception 'invalid:Unknown action'; end if;
  exception when others then
    err := sqlerrm;
    code := case when err ~ '^(invalid|disabled|not_found):' then split_part(err, ':', 1) else 'error' end;
    err := case when code = 'error' and err !~ '(Too many|Rate|attempts|reports)' then 'The request could not be completed' else regexp_replace(err, '^[a-z_]+:', '') end;
    st := case code when 'invalid' then 'invalid' when 'disabled' then 'disabled' when 'not_found' then 'invalid' else 'error' end;
  end;

  insert into public.mcp_requests (tool, status, error, duration_ms, client_name, area_lat, area_lng)
  values (p_tool, st, left(err, 200), extract(milliseconds from clock_timestamp() - t0)::int, left(p_client_name, 60),
    private.round1(coalesce(a ->> 'latitude', a ->> 'origin_latitude')), private.round1(coalesce(a ->> 'longitude', a ->> 'origin_longitude')));

  if st <> 'ok' then
    return jsonb_build_object('ok', false, 'code', code,
      'error', case when code = 'disabled' then 'This dataset is currently not available to AI assistants.' else err end);
  end if;
  return jsonb_build_object('ok', true, 'data', res || jsonb_build_object('data_notice', private.demo_notice()));
end $$;

-- MCP server: unchanged contract (secret header, then the shared runner).
create or replace function public.mcp_call(p_tool text, p_args jsonb default '{}', p_client text default null, p_client_name text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  hdr text := nullif(current_setting('request.headers', true), '');
  secret text := case when hdr is not null then hdr::jsonb ->> 'x-mcp-secret' end;
begin
  if p_tool !~ '^[a-z_]{3,40}$' or to_regprocedure(format('private.%I(jsonb)', 'tool_' || p_tool)) is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Unknown tool');
  end if;
  if secret is null or not exists (select 1 from private.mcp_config where secret_hash = encode(digest(secret, 'sha256'), 'hex')) then
    insert into public.mcp_requests (tool, status) values (p_tool, 'unauthorised');
    return jsonb_build_object('ok', false, 'code', 'unauthorised', 'error', 'This function is reserved for the SafeArrival MCP server');
  end if;
  return private.run_tool(p_tool, p_args, p_client, p_client_name);
end $$;

-- WhatsApp (webhook and simulator): the same tools. Every tool's output is already designed for
-- anonymous public callers (tokens/consent enforced inside the tool), so no secret is needed; the
-- caller's WhatsApp id is hashed for the rate-limit bucket and never stored.
-- ponytail: a caller can rotate p_client to dodge the per-visitor limit, exactly like an IP-rotating MCP client; add a global bucket if abused.
create or replace function public.assistant_tool(p_tool text, p_args jsonb default '{}', p_client text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  r := private.run_tool(p_tool, p_args, 'wa:' || left(encode(digest(coalesce(p_client, 'anonymous'), 'sha256'), 'hex'), 24), 'whatsapp');
  if p_tool = 'subscribe_safety_alerts' and (r ->> 'ok')::boolean then
    update public.alert_subscriptions set source = 'whatsapp',
      consent_text = replace(consent_text, 'via an AI assistant', 'via SafeArrival WhatsApp')
    where manage_token = split_part(r -> 'data' ->> 'manage_url', '/alerts/', 2);
  end if;
  return r;
end $$;

alter table public.alert_subscriptions drop constraint alert_subscriptions_source_check;
alter table public.alert_subscriptions add constraint alert_subscriptions_source_check check (source in ('ai_assistant', 'web', 'whatsapp'));

-- AI-integration usage page: show WhatsApp tool use as its own client family.
create or replace function private.client_family(ua text) returns text
language sql immutable set search_path = public, extensions as $$
  select case when ua is null then 'Unknown'
              when ua = 'whatsapp' then 'WhatsApp (SafeArrival)'
              when ua ilike 'claude%' then 'Claude'
              when ua ilike 'openai%' or ua ilike '%chatgpt%' then 'ChatGPT'
              when ua ilike 'cursor%' then 'Cursor'
              when ua ilike '%vscode%' or ua ilike '%copilot%' then 'VS Code'
              when ua ilike 'node%' or ua ilike '%undici%' then 'SDK / scripts'
              when ua = 'stdio' then 'Local (stdio)'
              else 'Other' end
$$;

-- ================================================================ 2. places visitors type (geocoding without a provider)
-- Public reference coordinates for well-known places, so "is Sea Point OK?" can call the
-- coordinate-based tools. Not safety information. Pickup points are searched too.
create table public.places (
  id text primary key,
  name text not null,
  aliases text[] not null default '{}',
  lat double precision not null,
  lng double precision not null
);
alter table public.places enable row level security;
create policy places_read on public.places for select using (true);
grant select on public.places to anon, authenticated;
revoke insert, update, delete, truncate on public.places from anon, authenticated;

insert into public.places (id, name, aliases, lat, lng) values
  ('cpt-airport', 'Cape Town International Airport', '{airport,cpt,"cape town airport","ct airport"}', -33.9700, 18.5980),
  ('va-waterfront', 'V&A Waterfront', '{waterfront,"v&a","va waterfront","v and a"}', -33.9036, 18.4207),
  ('city-bowl', 'Cape Town city centre', '{"city centre","city center",cbd,"city bowl","cape town"}', -33.9249, 18.4241),
  ('sea-point', 'Sea Point', '{"sea point",seapoint}', -33.9150, 18.3870),
  ('green-point', 'Green Point', '{"green point"}', -33.9070, 18.4080),
  ('camps-bay', 'Camps Bay', '{"camps bay"}', -33.9510, 18.3780),
  ('bo-kaap', 'Bo-Kaap', '{"bo-kaap","bo kaap"}', -33.9200, 18.4150),
  ('gardens', 'Gardens', '{gardens}', -33.9330, 18.4110),
  ('woodstock', 'Woodstock', '{woodstock}', -33.9280, 18.4470),
  ('observatory', 'Observatory', '{observatory,obs}', -33.9380, 18.4720),
  ('table-mountain', 'Table Mountain (lower cableway)', '{"table mountain",cableway}', -33.9480, 18.4030),
  ('claremont', 'Claremont', '{claremont}', -33.9810, 18.4650),
  ('constantia', 'Constantia', '{constantia}', -34.0230, 18.4250),
  ('muizenberg', 'Muizenberg', '{muizenberg}', -34.1080, 18.4700),
  ('bellville', 'Bellville', '{bellville}', -33.9000, 18.6290),
  ('cape-town-station', 'Cape Town Station', '{station,"train station","cape town station"}', -33.9222, 18.4253)
on conflict (id) do nothing;

-- Best match for a typed place name: known places first, then pickup points and partner hotels' areas.
create or replace function public.resolve_place(p_query text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with q as (select lower(trim(regexp_replace(coalesce(p_query, ''), '[?!.,]', '', 'g'))) as s)
  select (select to_jsonb(x) - 'rank' - 'score' from (
      -- longest alias found as whole words in the text wins ("cape town station" beats "cape town")
      select p.name, p.lat, p.lng, 'place' as source, 1 as rank, m.score from public.places p, q,
        lateral (select max(char_length(al)) as score from unnest(p.aliases || lower(p.name)) al
                 where q.s ~ ('(^|\W)' || regexp_replace(al, '([.&+*?()])', '\\\1', 'g') || '(\W|$)')) m
       where char_length(q.s) >= 3 and m.score is not null
      union all
      select name, lat, lng, 'pickup_point', 2, null from public.pickup_points, q where char_length(q.s) >= 3 and lower(name) like '%' || q.s || '%'
      union all
      select h.name || ' (' || h.area || ')', p.lat, p.lng, 'hotel_area', 3, null from public.hotels h join public.places p on lower(p.name) = lower(h.area), q
       where h.status = 'active' and char_length(q.s) >= 3 and q.s like '%' || lower(h.name) || '%'
      order by rank, score desc nulls last limit 1) x)
$$;

-- ================================================================ 3. incidents: categories, lifecycle, priority, contact
create or replace function private.incident_categories() returns text[]
language sql immutable set search_path = public, extensions as $$
  select array['driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam', 'intimidation',
               'cannot_locate_driver', 'other', 'stranded', 'medical_emergency', 'personal_safety'] || private.accommodation_categories()
$$;
alter table public.incidents drop constraint incidents_category_check;
alter table public.incidents add constraint incidents_category_check check (category in (
  'driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam', 'intimidation', 'cannot_locate_driver', 'other',
  'stranded', 'medical_emergency', 'personal_safety',
  'listing_mismatch', 'booking_payment_fraud', 'host_identity_mismatch', 'accommodation_unsafe', 'accommodation_other'));

-- service: the three new categories are about the visitor, not a transport or accommodation provider.
drop index if exists public.incidents_service_idx;
alter table public.incidents drop column service;
alter table public.incidents add column service text generated always as (case
  when category in ('listing_mismatch', 'booking_payment_fraud', 'host_identity_mismatch', 'accommodation_unsafe', 'accommodation_other') then 'accommodation'
  when category in ('stranded', 'medical_emergency', 'personal_safety') then 'general'
  else 'transport' end) stored;
create index incidents_service_idx on public.incidents (service, created_at desc);

-- Lifecycle: the original statuses stay valid; case-management statuses are added.
alter table public.incidents drop constraint incidents_status_check;
alter table public.incidents add constraint incidents_status_check check (status in (
  'received', 'hotel_notified', 'hotel_pending', 'provider_notified', 'escalated', 'referred_authorities', 'follow_up', 'resolved', 'closed',
  'triage', 'assigned', 'in_progress', 'awaiting_visitor', 'awaiting_partner', 'unable_to_contact'));

alter table public.incidents
  add column priority text not null default 'standard' check (priority in ('critical', 'urgent', 'standard')),
  add column priority_source text not null default 'system' check (priority_source in ('system', 'admin')),
  add column visitor_safe boolean,                 -- the visitor's latest answer to "are you safe now?"
  add column ongoing boolean,
  add column escalated_to text check (char_length(escalated_to) <= 120),
  add column resolution text check (char_length(resolution) <= 2000),
  -- Reporter's WhatsApp for case updates. Set only by the webhook (service role); never returned to visitors or MCP.
  add column contact_whatsapp text check (contact_whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  add column idempotency_key text unique check (char_length(idempotency_key) <= 80);
create index incidents_priority_idx on public.incidents (priority, status);
create index incidents_handler_idx on public.incidents (handler_id);

-- Suggested priority. Admins may change it; the system only ever raises it.
create or replace function private.suggest_priority(c text, urgent boolean, has_booking boolean) returns text
language sql immutable set search_path = public, extensions as $$
  select case
    when urgent or c = 'medical_emergency' then 'critical'
    when c in ('intimidation', 'stranded', 'personal_safety', 'accommodation_unsafe') then 'urgent'
    when has_booking and c in ('driver_mismatch', 'vehicle_mismatch', 'code_incorrect', 'cannot_locate_driver', 'extra_payment') then 'urgent'
    else 'standard' end
$$;
create or replace function private.rank_priority(p text) returns int
language sql immutable set search_path = public, extensions as $$ select case p when 'critical' then 3 when 'urgent' then 2 else 1 end $$;

create or replace function private.incident_priority() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare s text := private.suggest_priority(new.category, new.needs_immediate_help, new.booking_id is not null);
begin
  if tg_op = 'INSERT' then
    if new.priority_source = 'system' then new.priority := s; end if;
  elsif private.rank_priority(s) > private.rank_priority(new.priority) then
    new.priority := s;  -- never downgrade automatically
  end if;
  return new;
end $$;
create trigger incidents_priority before insert or update of category, needs_immediate_help on public.incidents
  for each row execute function private.incident_priority();
update public.incidents set priority = private.suggest_priority(category, needs_immediate_help, booking_id is not null);

create or replace function private.category_label(c text) returns text
language sql immutable set search_path = public, extensions as $$
  select case c
    when 'extra_payment' then 'Unexpected request for extra payment' when 'driver_mismatch' then 'Driver did not match the booking'
    when 'vehicle_mismatch' then 'Vehicle did not match the booking' when 'code_incorrect' then 'Incorrect verification code'
    when 'suspected_scam' then 'Suspected transport scam / touting' when 'intimidation' then 'Harassment, intimidation or threatening behaviour'
    when 'cannot_locate_driver' then 'Could not find the booked driver'
    when 'stranded' then 'Visitor lost or stranded'
    when 'medical_emergency' then 'Medical emergency'
    when 'personal_safety' then 'Personal safety concern'
    when 'listing_mismatch' then 'Accommodation did not match its listing'
    when 'booking_payment_fraud' then 'Suspicious accommodation booking or payment request'
    when 'host_identity_mismatch' then 'Accommodation provider identity or contact details inconsistent'
    when 'accommodation_unsafe' then 'Safety concern at an accommodation (check-in or location)'
    when 'accommodation_other' then 'Other accommodation problem'
    else 'Other tourism-related concern' end
$$;

create or replace function private.category_severity(c text) returns text
language sql immutable set search_path = public, extensions as $$
  select case when c in ('intimidation', 'accommodation_unsafe', 'medical_emergency', 'personal_safety') then 'high'
              when c in ('suspected_scam', 'extra_payment', 'driver_mismatch', 'vehicle_mismatch', 'code_incorrect',
                         'booking_payment_fraud', 'host_identity_mismatch', 'stranded') then 'medium'
              else 'low' end
$$;

create or replace function private.category_precaution(c text) returns text
language sql immutable set search_path = public, extensions as $$
  select case c
    when 'extra_payment' then 'Agree the price and payment method before pickup. A legitimate SafeArrival booking shows the agreed price; do not pay unexpected cash "fees".'
    when 'driver_mismatch' then 'Check the driver''s name and photo against your booking, and ask the driver to say your verification code first.'
    when 'vehicle_mismatch' then 'Check the registration plate, make and colour before getting in. If anything differs, do not get in.'
    when 'code_incorrect' then 'Never read your code out yourself. The driver must say it first; if they cannot, do not get in.'
    when 'suspected_scam' then 'Ignore unsolicited offers of transport inside terminals or on the street. Go to official ranks or meet your booked driver at the designated pickup point.'
    when 'intimidation' then 'Move to a busy, well-lit public place and contact the police on 10111 (or 112 from a mobile) if you feel threatened.'
    when 'cannot_locate_driver' then 'Wait at the designated pickup point and contact your hotel or provider; do not accept a lift from someone else.'
    when 'stranded' then 'Stay in a busy, well-lit public place (inside a terminal, hotel lobby or shop), keep your phone charged, and contact your accommodation. Do not accept lifts from strangers.'
    when 'medical_emergency' then 'Call 10177 (ambulance) or 112 from a mobile now. SafeArrival cannot send an ambulance.'
    when 'personal_safety' then 'Go to a busy, well-lit public place or your accommodation''s reception. If you are in danger call 10111 (police) or 112 from a mobile.'
    when 'listing_mismatch' then 'Compare the address, photos and contact details with the booking platform before you pay or arrive. If they differ, do not pay more until you have confirmed with the platform.'
    when 'booking_payment_fraud' then 'Pay only through the booking platform or the accommodation''s official channel. Be wary of requests to pay a deposit by bank transfer to a personal account, or urgent "pay now or lose the room" messages.'
    when 'host_identity_mismatch' then 'Confirm the phone number and email from the accommodation''s official website or booking platform, not from a message you received.'
    when 'accommodation_unsafe' then 'If you feel unsafe, go to a busy public place or reception and call 10111 (police) or 112 from a mobile.'
    when 'accommodation_other' then 'Keep your booking confirmation and payment records, and report anything unusual.'
    else 'Keep your booking details handy and report anything unusual.' end
$$;

-- What WhatsApp shows the moment it recognises a concern: the same label and precaution MCP uses.
create or replace function public.incident_category_info(p_category text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select case when p_category = any (private.incident_categories()) then jsonb_build_object(
    'category', p_category, 'label', private.category_label(p_category), 'precaution', private.category_precaution(p_category),
    'service', case when p_category = any (private.accommodation_categories()) then 'accommodation'
                    when p_category in ('stranded', 'medical_emergency', 'personal_safety') then 'general' else 'transport' end) end
$$;

-- ================================================================ 4. submission: idempotent, with case details
alter function public.report_incident(jsonb) set schema private;
alter function private.report_incident(jsonb) rename to report_incident_base;

create or replace function public.report_incident(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text := nullif(left(trim(coalesce(p ->> 'idempotency_key', '')), 80), ''); i public.incidents; r jsonb;
  svc boolean := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role';
  wa text := regexp_replace(coalesce(p ->> 'contact_whatsapp', ''), '[\s()-]', '', 'g');
begin
  if k is not null then
    select * into i from public.incidents where idempotency_key = k;
    if found then  -- a repeated tap or webhook retry: same case, no duplicate
      return jsonb_build_object('reference', i.reference, 'access_token', i.access_token, 'status', i.status, 'duplicate', true);
    end if;
  end if;
  r := private.report_incident_base(p);
  update public.incidents set idempotency_key = k,
    visitor_safe = case when p ->> 'visitor_safe' in ('true', 'false') then (p ->> 'visitor_safe')::boolean end,
    ongoing = case when p ->> 'ongoing' in ('true', 'false') then (p ->> 'ongoing')::boolean end,
    contact_whatsapp = case when svc and wa ~ '^\+[1-9][0-9]{7,14}$' then wa end
  where reference = r ->> 'reference';
  return r;
end $$;
grant execute on function public.report_incident(jsonb) to anon, authenticated;

-- ================================================================ 5. visitor notifications for case updates
-- A tourist is reachable through their booking, or through the WhatsApp number that reported.
create or replace function private.notify_reporter(i public.incidents, p_kind text, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if i.booking_id is not null or i.contact_whatsapp is not null then
    perform private.notify('whatsapp', 'tourist', p_kind, 'Update on your report', p_body, i.booking_id, i.id);
  end if;
end $$;

alter table public.notifications drop constraint notifications_delivery_status_check;
alter table public.notifications add constraint notifications_delivery_status_check
  check (delivery_status in ('simulated', 'queued', 'sent', 'failed', 'not_configured'));

-- Staff update (same rules as migration 3) with the new statuses, resolution capture and
-- notifications that also reach WhatsApp reporters without a booking.
create or replace function public.update_incident(p_incident uuid, p_status text, p_message text, p_public boolean default true) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i public.incidents; r text;
begin
  select * into i from public.incidents where id = p_incident for update;
  r := private.require_incident_staff(i);
  if p_status is not null and p_status not in ('received', 'hotel_notified', 'hotel_pending', 'provider_notified', 'escalated',
     'referred_authorities', 'follow_up', 'resolved', 'closed', 'triage', 'assigned', 'in_progress', 'awaiting_visitor',
     'awaiting_partner', 'unable_to_contact') then raise exception 'Unknown status'; end if;
  if char_length(trim(coalesce(p_message, ''))) < 3 then raise exception 'Add a short message explaining the update'; end if;
  if p_status = 'closed' and r <> 'admin' then raise exception 'Only the safety team can close a report — mark it resolved instead'; end if;
  if p_status in ('triage', 'assigned', 'unable_to_contact') and r <> 'admin' then raise exception 'Only the safety team can set this status'; end if;
  if p_status = 'awaiting_visitor' and not p_public then raise exception 'A request for information must be shared with the visitor'; end if;

  if p_status is not null then
    update public.incidents set status = p_status,
      closed_at = case when p_status in ('resolved', 'closed') then now() end,
      resolution = case when p_status in ('resolved', 'closed') then coalesce(resolution, left(trim(p_message), 2000)) else resolution end
    where id = i.id;
  end if;
  insert into public.incident_updates (incident_id, status, message, visibility, author_id, author_label)
  values (i.id, p_status, left(trim(p_message), 2000), case when p_public then 'public' else 'internal' end, auth.uid(), private.actor_label());

  if p_status in ('provider_notified', 'escalated', 'awaiting_partner') and i.provider_id is not null then
    perform private.notify('dashboard', 'provider', 'incident', case p_status when 'escalated' then 'Escalated to your safety team · ' else 'Incident · ' end || i.reference,
      p_message, i.booking_id, i.id, null, i.provider_id);
  end if;
  if r <> 'hotel_staff' and i.hotel_id is not null then
    perform private.notify('dashboard', 'hotel', 'incident_update', 'Update on ' || i.reference, p_message, i.booking_id, i.id, i.hotel_id);
  end if;
  if p_public then
    perform private.notify_reporter(i, case when p_status = 'awaiting_visitor' then 'incident_info_request' else 'incident_update' end,
      format(E'Update on your report %s:\n\n%s%s', i.reference, trim(p_message),
        case when p_status = 'awaiting_visitor' then E'\n\nReply here with the details, or type *check my report*.' else '' end));
  end if;
  perform private.audit('update_incident', 'incident', i.id, jsonb_build_object('status', p_status, 'public', p_public));
end $$;

-- Assigning a case owner moves a new case to "assigned" and tells the visitor (without naming the owner).
create or replace function public.assign_incident_handler(p_incident uuid, p_handler uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i public.incidents;
begin
  perform private.require_admin();
  if p_handler is not null and not exists (select 1 from public.profiles where id = p_handler and role = 'admin') then
    raise exception 'Handlers must be safety-team (admin) users';
  end if;
  update public.incidents set handler_id = p_handler,
    status = case when p_handler is not null and status in ('received', 'triage') then 'assigned' else status end
  where id = p_incident returning * into i;
  if i.id is null then raise exception 'Incident not found'; end if;
  insert into public.incident_updates (incident_id, message, visibility, author_id, author_label)
  values (p_incident, 'Case owner set to ' || coalesce((select full_name from public.profiles where id = p_handler), 'nobody'), 'internal', auth.uid(), private.actor_label());
  if p_handler is not null and i.status = 'assigned' then
    insert into public.incident_updates (incident_id, status, message, author_label)
    values (i.id, 'assigned', 'A member of the SafeArrival safety team is now handling your report.', 'SafeArrival safety team');
    perform private.notify_reporter(i, 'incident_update', format(E'Update on your report %s:\n\nA member of the SafeArrival safety team is now handling your report.', i.reference));
  end if;
  perform private.audit('assign_handler', 'incident', p_incident, jsonb_build_object('handler', p_handler));
end $$;

create or replace function public.set_incident_priority(p_incident uuid, p_priority text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare old text;
begin
  perform private.require_admin();
  if p_priority not in ('critical', 'urgent', 'standard') then raise exception 'Priority must be critical, urgent or standard'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a short reason for the priority change'; end if;
  select priority into old from public.incidents where id = p_incident for update;
  if old is null then raise exception 'Incident not found'; end if;
  update public.incidents set priority = p_priority, priority_source = 'admin' where id = p_incident;
  insert into public.incident_updates (incident_id, message, visibility, author_id, author_label)
  values (p_incident, format('Priority %s → %s: %s', old, p_priority, left(trim(p_reason), 500)), 'internal', auth.uid(), private.actor_label());
  perform private.audit('set_priority', 'incident', p_incident, jsonb_build_object('from', old, 'to', p_priority));
end $$;

-- Escalation with a recorded destination (e.g. "SAPS Table Bay", "Provider safety desk").
create or replace function public.escalate_incident(p_incident uuid, p_to text, p_message text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  if char_length(trim(coalesce(p_to, ''))) not between 2 and 120 then raise exception 'Say who the report is escalated to'; end if;
  update public.incidents set escalated_to = trim(p_to) where id = p_incident;
  insert into public.incident_updates (incident_id, message, visibility, author_id, author_label)
  values (p_incident, 'Escalated to: ' || trim(p_to), 'internal', auth.uid(), private.actor_label());
  perform public.update_incident(p_incident, 'escalated', p_message, true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.set_incident_priority(uuid, text, text)', 'public.escalate_incident(uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ================================================================ 6. visitor follow-up (holder of the tracking token)
-- kind: 'info' (add information), 'safe' (I am safe now), 'help' (I need more help).
-- Updates the SAME case; never resolves or downgrades it.
create or replace function public.incident_followup(p_token text, p_kind text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare i public.incidents; msg text := left(trim(coalesce(p_message, '')), 1000); note text;
begin
  select * into i from public.incidents where access_token = p_token for update;
  if i.id is null or length(coalesce(p_token, '')) < 20 then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if p_kind not in ('info', 'safe', 'help') then raise exception 'Unknown follow-up'; end if;
  if i.status = 'closed' then raise exception 'This report is closed. If something new happened, please make a new report.'; end if;
  if p_kind = 'info' and char_length(msg) < 3 then raise exception 'Type the information you want to add'; end if;
  if (select count(*) from public.incident_updates where incident_id = i.id and author_label = 'Visitor' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many follow-ups on this report in the last hour. If you are in danger call 10111 or 112.';
  end if;

  note := case p_kind when 'info' then 'Visitor added information: ' || msg
                      when 'safe' then 'Visitor says they are safe now.' || coalesce(' ' || nullif(msg, ''), '')
                      else 'Visitor asked for more help.' || coalesce(' ' || nullif(msg, ''), '') end;
  insert into public.incident_updates (incident_id, message, visibility, author_label) values (i.id, note, 'internal', 'Visitor');

  update public.incidents set
    visitor_safe = case p_kind when 'safe' then true when 'help' then false else visitor_safe end,
    priority = case when p_kind = 'help' and priority = 'standard' then 'urgent' else priority end,
    status = case when status in ('awaiting_visitor', 'unable_to_contact') then 'in_progress' else status end
  where id = i.id returning * into i;
  if i.status = 'in_progress' then
    insert into public.incident_updates (incident_id, status, message, author_label)
    values (i.id, 'in_progress', 'Thank you. The information you sent has been added to your report.', 'SafeArrival safety team');
  end if;

  perform private.notify('dashboard', 'admin', 'incident_followup', 'Visitor follow-up on ' || i.reference,
    case p_kind when 'help' then 'VISITOR ASKS FOR MORE HELP' when 'safe' then 'Visitor says they are safe now' else 'Visitor added information' end, i.booking_id, i.id);
  if i.hotel_id is not null then
    perform private.notify('dashboard', 'hotel', 'incident_followup', 'Visitor follow-up on ' || i.reference,
      case p_kind when 'help' then 'Visitor asks for more help' when 'safe' then 'Visitor says they are safe now' else 'Visitor added information' end, i.booking_id, i.id, i.hotel_id);
  end if;
  return jsonb_build_object('reference', i.reference, 'status', i.status, 'recorded', p_kind);
end $$;

-- ================================================================ 7. WhatsApp inbound de-duplication (race-safe)
create table public.whatsapp_inbound (
  message_id text primary key,
  received_at timestamptz not null default now()
);
alter table public.whatsapp_inbound enable row level security;   -- no policies: webhook (service role) only
revoke all on public.whatsapp_inbound from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
