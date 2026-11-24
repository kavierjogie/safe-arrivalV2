-- 6/6  SafeArrival MCP: public safety intelligence for AI assistants.
--
-- One entry point, public.mcp_call(tool, args, client, client_name), used ONLY by
-- the MCP server (mcp-server/). It checks a shared server secret sent as the
-- `x-mcp-secret` request header, applies per-client rate limits and dataset
-- toggles, runs the tool and logs the call (tool, outcome, duration; never the
-- arguments). The MCP server therefore needs only the ANON key, never the
-- service-role key.
--
-- Trust model for public output:
--   * Raw incident descriptions are NEVER returned. They are untrusted free text
--     (personal data, prompt injection). Public output uses the category, a
--     templated phrase, and an admin-written `public_summary` for verified items.
--   * Locations are pickup points (public places) or coordinates rounded to ~1 km.
--   * Every result states its source, verification status, timestamps,
--     geographic precision and limitations. No safety scores, no rankings.

-- ================================================================ incidents: verification + approximate location
alter table public.incidents
  add column verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'official_advisory', 'rejected')),
  add column verified_at timestamptz,
  add column verified_by uuid references public.profiles (id) on delete set null,
  add column public_summary text check (char_length(public_summary) <= 500),
  add column public_until timestamptz,          -- after this the item is "expired" (still historical)
  add column source text not null default 'tourist_report'
    check (source in ('tourist_report', 'ai_assistant_report', 'safearrival_team')),
  add column occurred_at timestamptz,           -- when it happened, if the reporter said
  add column approx_lat double precision check (approx_lat between -90 and 90),
  add column approx_lng double precision check (approx_lng between -180 and 180),
  add column geo_precision text check (geo_precision in ('pickup_point', 'approximate_1km', 'unknown'));
create index incidents_geo_idx on public.incidents (approx_lat, approx_lng);

-- Reports tied to a pickup point inherit its (public) coordinates.
create or replace function private.incident_geo() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.approx_lat is null and new.pickup_point_id is not null then
    select lat, lng into new.approx_lat, new.approx_lng from public.pickup_points where id = new.pickup_point_id;
    new.geo_precision := 'pickup_point';
  end if;
  new.geo_precision := coalesce(new.geo_precision, case when new.approx_lat is null then 'unknown' end);
  return new;
end $$;
create trigger incidents_geo before insert or update of pickup_point_id, approx_lat, approx_lng on public.incidents
  for each row execute function private.incident_geo();
update public.incidents set approx_lat = null where approx_lat is null; -- fire the trigger for any existing rows

-- Admin (safety team) sets what the public may see about an incident.
create or replace function public.set_incident_verification(p_incident uuid, p_status text, p_summary text default null,
  p_public_days int default 30) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  if p_status not in ('unverified', 'verified', 'official_advisory', 'rejected') then raise exception 'Unknown verification status'; end if;
  if p_status in ('verified', 'official_advisory') and char_length(trim(coalesce(p_summary, ''))) < 10 then
    raise exception 'Write a short public summary (no names, plates or exact addresses) before publishing';
  end if;
  if p_public_days not between 1 and 365 then raise exception 'Public period must be 1–365 days'; end if;
  update public.incidents set verification_status = p_status,
    public_summary = nullif(left(trim(p_summary), 500), ''),
    verified_at = case when p_status in ('verified', 'official_advisory') then now() end,
    verified_by = case when p_status in ('verified', 'official_advisory') then auth.uid() end,
    public_until = case when p_status in ('verified', 'official_advisory') then now() + make_interval(days => p_public_days) end
  where id = p_incident;
  if not found then raise exception 'Incident not found'; end if;
  perform private.audit('set_verification', 'incident', p_incident, jsonb_build_object('status', p_status));
end $$;

-- ================================================================ reference data (public, read-only)
create table public.emergency_contacts (
  id text primary key,
  name text not null,
  number text not null,
  kind text not null check (kind in ('police', 'ambulance', 'all_emergencies', 'municipal', 'private_ambulance', 'sea_rescue', 'mountain_rescue', 'helpline')),
  region text not null default 'national',   -- 'national' or a coverage area name
  notes text,
  priority int not null default 100,
  updated_at timestamptz not null default now()
);

-- Curated, dated guidance. Deliberately about behaviour and transport, never about "bad areas".
create table public.safety_advice (
  id text primary key,
  context text not null check (context in ('general', 'airport_arrival', 'ehailing', 'shuttle', 'night', 'outdoors', 'emergency')),
  title text not null,
  advice text not null,
  updated_at timestamptz not null default now()
);

-- Calls from MCP clients. No arguments, no IPs, no personal data.
create table public.mcp_requests (
  id bigint generated always as identity primary key,
  tool text not null,
  status text not null check (status in ('ok', 'error', 'invalid', 'rate_limited', 'disabled', 'unauthorised')),
  error text,
  duration_ms int,
  client_name text,                          -- from MCP clientInfo, e.g. "claude-ai", "chatgpt"
  area_lat numeric(4, 1),                    -- query area rounded to ~10 km, for usage maps
  area_lng numeric(4, 1),
  created_at timestamptz not null default now()
);
create index mcp_requests_created_idx on public.mcp_requests (created_at desc);

alter table public.emergency_contacts enable row level security;
alter table public.safety_advice enable row level security;
alter table public.mcp_requests enable row level security;
create policy emergency_read on public.emergency_contacts for select using (true);
create policy advice_read on public.safety_advice for select using (true);
create policy mcp_requests_read on public.mcp_requests for select using (app.is_admin());
grant select on public.emergency_contacts, public.safety_advice, public.mcp_requests to anon, authenticated;
revoke insert, update, delete, truncate on public.emergency_contacts, public.safety_advice, public.mcp_requests from anon, authenticated;

-- Private: server secret + rate-limit counters (no client can reach schema `private`).
create table private.mcp_config (id int primary key default 1 check (id = 1), secret_hash text not null);
create table private.mcp_rate (client text not null, bucket text not null, window_start timestamptz not null, hits int not null default 1,
  primary key (client, bucket, window_start));

-- Run once as the database owner (SQL editor):  select private.set_mcp_secret('<long random string>');
create or replace function private.set_mcp_secret(p_secret text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(p_secret, '')) < 32 then raise exception 'Use a secret of at least 32 characters'; end if;
  insert into private.mcp_config (id, secret_hash) values (1, encode(digest(p_secret, 'sha256'), 'hex'))
  on conflict (id) do update set secret_hash = excluded.secret_hash;
end $$;

insert into public.app_settings (key, value) values
  -- Which datasets public MCP clients may read. Admins switch these off without a deploy.
  ('mcp_datasets', '{"incident_reports": true, "advisories": true, "pickup_points": true, "providers": true, "emergency_contacts": true, "safety_advice": true}'),
  -- Where SafeArrival has any data at all. Outside these, tools say "no coverage".
  ('mcp_coverage', '[{"name": "Cape Town", "lat": -33.93, "lng": 18.55, "radius_km": 60}]')
on conflict (key) do nothing;

-- ================================================================ helpers
create or replace function private.km(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Distance (km) from a point to the straight segment a→b (local flat projection; fine at city scale).
create or replace function private.km_to_segment(plat float8, plng float8, alat float8, alng float8, blat float8, blng float8) returns float8
language plpgsql immutable as $$
declare k float8 := cos(radians((alat + blat) / 2)); ax float8; ay float8; bx float8; by_ float8; px float8; py float8; t float8;
begin
  ax := alng * k; ay := alat; bx := blng * k; by_ := blat; px := plng * k; py := plat;
  t := case when (bx - ax) ^ 2 + (by_ - ay) ^ 2 = 0 then 0
            else greatest(0, least(1, ((px - ax) * (bx - ax) + (py - ay) * (by_ - ay)) / ((bx - ax) ^ 2 + (by_ - ay) ^ 2))) end;
  return private.km(plat, plng, ay + t * (by_ - ay), (ax + t * (bx - ax)) / k);
end $$;

create or replace function private.num(a jsonb, k text, lo float8, hi float8, fallback float8 default null) returns float8
language plpgsql immutable as $$
declare v float8;
begin
  if a ->> k is null then
    if fallback is null then raise exception 'invalid:% is required', k; end if;
    return fallback;
  end if;
  begin v := (a ->> k)::float8; exception when others then raise exception 'invalid:% must be a number', k; end;
  if v < lo or v > hi or v <> v then raise exception 'invalid:% must be between % and %', k, lo, hi; end if;
  return v;
end $$;

-- Coarse (~10 km) coordinate for usage analytics; null for anything that isn't a plain number.
create or replace function private.round1(v text) returns numeric
language sql immutable as $$ select case when v ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' and abs(v::numeric) <= 180 then round(v::numeric, 1) end $$;

create or replace function private.category_label(c text) returns text
language sql immutable as $$
  select case c
    when 'extra_payment' then 'Unexpected request for extra payment' when 'driver_mismatch' then 'Driver did not match the booking'
    when 'vehicle_mismatch' then 'Vehicle did not match the booking' when 'code_incorrect' then 'Incorrect verification code'
    when 'suspected_scam' then 'Suspected transport scam / touting' when 'intimidation' then 'Intimidation or threatening behaviour'
    when 'cannot_locate_driver' then 'Could not find the booked driver' else 'Other transport problem' end
$$;

create or replace function private.category_severity(c text) returns text
language sql immutable as $$
  select case when c = 'intimidation' then 'high'
              when c in ('suspected_scam', 'extra_payment', 'driver_mismatch', 'vehicle_mismatch', 'code_incorrect') then 'medium'
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
    else 'Keep your booking details handy and report anything unusual.' end
$$;

create or replace function private.demo_notice() returns text
language sql stable as $$
  select case when private.setting('demo_mode', 'false') = 'true'::jsonb
    then 'DEMO DATA: every report, hotel, provider and driver here is fictional, created for a hackathon demonstration. It is not real-world crime or safety intelligence.' end
$$;

create or replace function private.dataset_on(k text) returns boolean
language sql stable as $$ select coalesce((private.setting('mcp_datasets', '{}') ->> k)::boolean, false) $$;

create or replace function private.coverage_for(plat float8, plng float8) returns text
language sql stable as $$
  select c ->> 'name' from jsonb_array_elements(private.setting('mcp_coverage', '[]')) c
  where private.km(plat, plng, (c ->> 'lat')::float8, (c ->> 'lng')::float8) <= (c ->> 'radius_km')::float8 limit 1
$$;

-- The ONLY shape in which an incident leaves the database through MCP.
create or replace function private.public_incident(i public.incidents, plat float8 default null, plng float8 default null) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'type', case when i.verification_status = 'official_advisory' then 'safety_advisory'
                 when i.verification_status = 'verified' then 'verified_incident' else 'unverified_report' end,
    'verification_status', i.verification_status,
    'category', i.category, 'category_label', private.category_label(i.category),
    'severity', private.category_severity(i.category),
    'summary', case when i.verification_status in ('verified', 'official_advisory') and i.public_summary is not null then i.public_summary
                    else private.category_label(i.category) || ' (reported by a traveller; details not published)' end,
    'source', case i.source when 'safearrival_team' then 'SafeArrival safety team' when 'ai_assistant_report' then 'Traveller report via AI assistant'
                            else 'Traveller report via SafeArrival' end,
    'reported_at', i.created_at, 'occurred_at', i.occurred_at, 'last_updated', i.updated_at, 'verified_at', i.verified_at,
    'public_until', i.public_until,
    'review_status', case when i.verification_status in ('verified', 'official_advisory') and i.public_until < now() then 'expired'
                          when i.verification_status in ('verified', 'official_advisory') then 'active'
                          when i.status in ('resolved', 'closed') then 'case_closed' else 'under_review' end,
    'is_historical', i.created_at < now() - interval '30 days',
    'location', jsonb_build_object(
      'area_name', (select name from public.pickup_points where id = i.pickup_point_id),
      'approx_lat', round(i.approx_lat::numeric, 2), 'approx_lng', round(i.approx_lng::numeric, 2),
      'precision', coalesce(i.geo_precision, 'unknown'),
      'distance_km', case when plat is not null and i.approx_lat is not null then round(private.km(plat, plng, i.approx_lat, i.approx_lng)::numeric, 1) end),
    'precaution', private.category_precaution(i.category))
$$;

-- Incidents the public may see: never rejected, never undated.
create or replace function private.visible_incidents(p_days int, p_include_unverified boolean) returns setof public.incidents
language sql stable security definer set search_path = public, extensions as $$
  select * from public.incidents
  where verification_status <> 'rejected'
    and created_at >= now() - make_interval(days => p_days)
    and (p_include_unverified or verification_status in ('verified', 'official_advisory'))
    and (private.dataset_on('incident_reports') or verification_status = 'official_advisory')
    and (private.dataset_on('advisories') or verification_status <> 'official_advisory')
$$;

create or replace function private.limitations(extra text[] default '{}') returns jsonb
language sql stable as $$
  select to_jsonb(array[
    'SafeArrival data covers transport-related reports from travellers (pickups, drivers, touting, payment requests), not general crime.',
    'The absence of reports does NOT mean an area or route is safe; it only means SafeArrival has not received reports.',
    'Unverified reports have not been confirmed by the SafeArrival safety team and must not be treated as confirmed crimes.',
    'Locations are approximate (pickup point or ~1 km) to protect the people who reported.'
  ] || extra || coalesce(array[private.demo_notice()], '{}'))
$$;

-- ================================================================ tools
create or replace function private.tool_check_area_safety(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  lat float8 := private.num(a, 'latitude', -90, 90); lng float8 := private.num(a, 'longitude', -180, 180);
  r float8 := private.num(a, 'radius_km', 0.2, 25, 2); days int := private.num(a, 'period_days', 1, 365, 90)::int;
  rows public.incidents[]; cov text := private.coverage_for(lat, lng);
begin
  select coalesce(array_agg(i order by i.created_at desc), '{}') into rows
  from private.visible_incidents(days, true) i
  where i.approx_lat is not null and private.km(lat, lng, i.approx_lat, i.approx_lng) <= r;

  return jsonb_build_object(
    'query', jsonb_build_object('latitude', lat, 'longitude', lng, 'radius_km', r, 'location_name', left(a ->> 'location_name', 80),
      'reporting_period', jsonb_build_object('days', days, 'from', now() - make_interval(days => days), 'to', now())),
    'coverage', jsonb_build_object('covered', cov is not null, 'area', cov,
      'note', case when cov is null then 'SafeArrival has no data coverage for this location yet. No conclusion about safety can be drawn.' end),
    'summary', jsonb_build_object(
      'total_reports', cardinality(rows),
      'verified_incidents', (select count(*) from unnest(rows) x where x.verification_status = 'verified'),
      'unverified_reports', (select count(*) from unnest(rows) x where x.verification_status = 'unverified'),
      'safety_advisories', (select count(*) from unnest(rows) x where x.verification_status = 'official_advisory'),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', c, 'label', private.category_label(c), 'count', n) order by n desc)
                     from (select x.category c, count(*) n from unnest(rows) x group by 1) g), '[]'),
      'latest_report_at', (select max(x.created_at) from unnest(rows) x)),
    'reports', coalesce((select jsonb_agg(private.public_incident(x, lat, lng)) from (select * from unnest(rows) limit 25) x), '[]'),
    'guidance', jsonb_build_array(
      'Use a pre-booked, verifiable transport option and meet your driver at the designated pickup point.',
      'Ask your driver to say your SafeArrival verification code first; never read it out yourself.',
      'In an emergency call 10111 (police) or 112 from a mobile.'),
    'data_freshness', jsonb_build_object('generated_at', now(), 'latest_record_updated_at', (select max(x.updated_at) from unnest(rows) x)),
    'limitations', private.limitations());
end $$;

create or replace function private.tool_get_safety_alerts(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  has_point boolean := a ? 'latitude' or a ? 'longitude';
  lat float8; lng float8; r float8 := private.num(a, 'radius_km', 0.2, 50, 10);
  days int := private.num(a, 'days', 1, 90, 14)::int;
  cat text := nullif(a ->> 'category', ''); unverified boolean := coalesce((a ->> 'include_unverified')::boolean, true);
  expired boolean := coalesce((a ->> 'include_expired')::boolean, false); out jsonb;
begin
  if has_point then lat := private.num(a, 'latitude', -90, 90); lng := private.num(a, 'longitude', -180, 180); end if;
  select coalesce(jsonb_agg(private.public_incident(i, lat, lng) order by
           (i.verification_status = 'official_advisory') desc, (i.verification_status = 'verified') desc, i.created_at desc), '[]') into out
  from (select * from private.visible_incidents(days, unverified) v
        where (cat is null or v.category = cat)
          and (not has_point or (v.approx_lat is not null and private.km(lat, lng, v.approx_lat, v.approx_lng) <= r))
          and (expired or v.public_until is null or v.public_until >= now())
        order by v.created_at desc limit 30) i;
  -- Advisories are published for a period; outside it they still count as history above if include_expired.
  return jsonb_build_object(
    'query', jsonb_build_object('latitude', lat, 'longitude', lng, 'radius_km', case when has_point then r end, 'category', cat,
      'days', days, 'include_unverified', unverified, 'include_expired', expired),
    'alerts', out,
    'counts', jsonb_build_object('total', jsonb_array_length(out),
      'verified_or_advisory', (select count(*) from jsonb_array_elements(out) e where e ->> 'type' <> 'unverified_report')),
    'data_freshness', jsonb_build_object('generated_at', now()),
    'limitations', private.limitations());
end $$;

create or replace function private.tool_check_route_safety(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  olat float8 := private.num(a, 'origin_latitude', -90, 90); olng float8 := private.num(a, 'origin_longitude', -180, 180);
  dlat float8 := private.num(a, 'destination_latitude', -90, 90); dlng float8 := private.num(a, 'destination_longitude', -180, 180);
  buf float8 := private.num(a, 'corridor_km', 0.2, 5, 1); days int := private.num(a, 'period_days', 1, 365, 90)::int;
  len float8 := private.km(olat, olng, dlat, dlng); out jsonb;
begin
  if len > 150 then raise exception 'invalid:Route is longer than 150 km; SafeArrival only covers city-scale transfers'; end if;
  select coalesce(jsonb_agg(private.public_incident(i, olat, olng) order by i.created_at desc), '[]') into out
  from (select * from private.visible_incidents(days, true) v
        where v.approx_lat is not null and private.km_to_segment(v.approx_lat, v.approx_lng, olat, olng, dlat, dlng) <= buf
        order by v.created_at desc limit 25) i;
  return jsonb_build_object(
    'query', jsonb_build_object('origin', jsonb_build_object('latitude', olat, 'longitude', olng),
      'destination', jsonb_build_object('latitude', dlat, 'longitude', dlng), 'travel_mode', coalesce(a ->> 'travel_mode', 'unspecified'),
      'period_days', days),
    'route_model', jsonb_build_object('method', 'straight_line_corridor', 'corridor_km', buf, 'straight_line_km', round(len::numeric, 1),
      'note', 'No routing provider is configured, so reports are matched within a corridor around the straight line between origin and destination. The actual road route may differ.'),
    'origin_coverage', private.coverage_for(olat, olng), 'destination_coverage', private.coverage_for(dlat, dlng),
    'reports_near_route', out,
    'categories', coalesce((select jsonb_object_agg(c, n) from (select e ->> 'category' c, count(*) n from jsonb_array_elements(out) e group by 1) g), '{}'),
    'alternative_routes', jsonb_build_object('available', false, 'note', 'Alternative route information requires a routing provider, which is not configured.'),
    'precautions', jsonb_build_array(
      'Use a pre-booked or app-based ride you can verify (driver name, photo, registration).',
      'Share your trip details with someone you trust.',
      'If the driver changes plan, asks for extra cash, or you feel unsafe, ask to stop in a busy public place and call 10111 or 112.'),
    'data_freshness', jsonb_build_object('generated_at', now()),
    'limitations', private.limitations(array['SafeArrival does not predict crime and cannot guarantee that any route is safe.']));
end $$;

create or replace function private.tool_verify_transport_provider(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare q text := trim(coalesce(a ->> 'provider_name', '')); pid text := nullif(a ->> 'provider_id', ''); out jsonb;
begin
  if not private.dataset_on('providers') then raise exception 'disabled:providers'; end if;
  if pid is null and char_length(q) < 3 then raise exception 'invalid:provider_name needs at least 3 characters'; end if;
  if pid is not null and pid !~ '^[0-9a-f-]{36}$' then raise exception 'invalid:provider_id must be a UUID'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'provider_id', p.id, 'name', p.name,
      'type', case p.provider_type when 'hotel_fleet' then 'Hotel transport fleet' when 'shuttle' then 'Shuttle company' else 'E-hailing (integration)' end,
      'safearrival_status', case p.status when 'active' then 'approved_partner' when 'pending' then 'under_review_not_approved' else 'suspended' end,
      'meaning', case p.status
        when 'active' then 'Approved SafeArrival partner: onboarded, with drivers individually approved by the SafeArrival safety team.'
        when 'pending' then 'Known to SafeArrival but NOT yet approved. Do not treat as a SafeArrival partner.'
        else 'SafeArrival partnership is suspended. Do not book through SafeArrival with this provider.' end,
      'contacts', case when p.status = 'active' then jsonb_build_object('phone', p.contact_phone, 'email', p.contact_email, 'safety_contact', p.safety_contact) end,
      'service_coverage', (select coalesce(jsonb_agg(area order by area), '[]') from public.provider_service_areas where provider_id = p.id),
      'approved_drivers', case when p.status = 'active' then (select count(*) from public.drivers where provider_id = p.id and status = 'approved') end,
      'simulated_integration', p.integration = 'uber_central',
      'status_last_changed', p.updated_at) order by p.status = 'active' desc, p.name), '[]') into out
  from (select * from public.transport_providers t
        where (pid is not null and t.id::text = pid) or (pid is null and t.name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%')
        limit 5) p;
  return jsonb_build_object('query', jsonb_build_object('provider_name', nullif(q, ''), 'provider_id', pid), 'matches', out,
    'result', case when jsonb_array_length(out) = 0 then 'not_a_safearrival_partner' else 'found' end,
    'note', 'This only tells you whether a provider is a SafeArrival partner. A provider that is not listed may still be a legitimate, licensed operator; SafeArrival simply has not verified it.',
    'verified_at', now(), 'data_notice', private.demo_notice());
end $$;

-- Matches what the tourist SEES/HEARS against the booking. Returns booleans only:
-- never the code, the driver's name, phone or the registration.
create or replace function private.tool_verify_driver(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.bookings; tok text := a ->> 'booking_token'; code text := nullif(trim(a ->> 'spoken_code'), '');
  reg text := nullif(upper(regexp_replace(coalesce(a ->> 'vehicle_registration', ''), '[^A-Za-z0-9]', '', 'g')), '');
  nm text := nullif(lower(trim(a ->> 'driver_name')), '');
  d public.drivers; v public.vehicles; code_res text := 'not_checked'; reg_res text := 'not_checked'; name_res text := 'not_checked';
  steps text[];
begin
  if tok is null or tok !~ '^[0-9a-f]{20,64}$' then raise exception 'invalid:booking_token is the private code from your SafeArrival booking link'; end if;
  begin b := private.booking_by_token(tok); exception when others then raise exception 'not_found:No booking matches that token'; end;
  select d2.* into d from public.booking_drivers bd join public.drivers d2 on d2.id = bd.driver_id where bd.booking_id = b.id and bd.active;
  select v2.* into v from public.booking_drivers bd join public.vehicles v2 on v2.id = bd.vehicle_id where bd.booking_id = b.id and bd.active;

  if b.status not in ('driver_assigned', 'driver_on_way', 'driver_arrived') then
    return jsonb_build_object('booking_status', b.status, 'can_verify', false,
      'next_steps', to_jsonb(case
        when b.status in ('pending', 'awaiting_provider', 'confirmed') then array['No driver has been assigned yet. Do not go with anyone claiming to be your driver until you receive the assignment message.']
        when b.status = 'in_progress' then array['This ride has already started (the code was used). If you are not in the booked vehicle, get to a safe public place and call 10111 or 112.']
        else array['This booking is ' || b.status || '. Its verification code is no longer valid. Do not get into any vehicle claiming to be this booking.'] end));
  end if;

  if code is not null then code_res := case when (public.check_spoken_code(tok, code) ->> 'match')::boolean then 'match' else 'mismatch' end; end if;
  if reg is not null then reg_res := case when regexp_replace(upper(v.registration), '[^A-Z0-9]', '', 'g') = reg then 'match' else 'mismatch' end; end if;
  if nm is not null then
    name_res := case when lower(d.full_name) = nm or split_part(lower(d.full_name), ' ', 1) = split_part(nm, ' ', 1) then 'match' else 'mismatch' end;
  end if;

  steps := case
    when 'mismatch' in (code_res, reg_res, name_res) then array[
      'DO NOT get into the vehicle.', 'Move to a busy, well-lit public place (inside the terminal at the airport).',
      'Use "Something''s wrong" on your booking page, or report it with report_safety_incident, so your hotel is alerted.',
      'If you feel threatened call 10111 (police) or 112 from a mobile.']
    when code_res = 'match' then array[
      'The spoken code matches your booking.', 'Also check the registration plate and vehicle against your booking page.',
      'Confirm "Code matches" on your booking page to start the ride; this uses the code so it cannot be reused.']
    else array[
      'Ask the driver to say your verification code FIRST. Never read it out or show it yourself.',
      'Check the registration plate, vehicle and driver photo against your booking page.',
      'If anything does not match, do not get in.'] end;

  return jsonb_build_object('booking_status', b.status, 'can_verify', true,
    'checks', jsonb_build_object('spoken_code', code_res, 'vehicle_registration', reg_res, 'driver_name', name_res),
    'code_active', exists (select 1 from public.verification_codes where booking_id = b.id and status = 'active'),
    'vehicle_assigned', v.id is not null,
    'next_steps', to_jsonb(steps),
    'privacy', 'No driver details, codes or booking data are returned. Code checks are rate-limited (5 per 10 minutes per booking).');
end $$;

create or replace function private.tool_report_safety_incident(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  res jsonb; lat float8; lng float8; pp text := nullif(a ->> 'pickup_point_id', ''); occurred timestamptz;
  urgent boolean := coalesce((a ->> 'urgent')::boolean, false);
begin
  if coalesce((a ->> 'user_confirmed')::boolean, false) is not true then
    raise exception 'invalid:Ask the user to confirm the report details, then call again with user_confirmed=true';
  end if;
  if char_length(trim(coalesce(a ->> 'description', ''))) < 10 then raise exception 'invalid:description needs at least 10 characters'; end if;
  if pp is not null and not exists (select 1 from public.pickup_points where id = pp) then raise exception 'invalid:Unknown pickup_point_id'; end if;
  if a ? 'latitude' then
    lat := round(private.num(a, 'latitude', -90, 90)::numeric, 2); lng := round(private.num(a, 'longitude', -180, 180)::numeric, 2);
  end if;
  if a ->> 'occurred_at' is not null then
    begin occurred := (a ->> 'occurred_at')::timestamptz; exception when others then raise exception 'invalid:occurred_at must be an ISO 8601 date-time'; end;
    if occurred > now() + interval '10 minutes' or occurred < now() - interval '30 days' then raise exception 'invalid:occurred_at must be within the last 30 days'; end if;
  end if;

  res := public.report_incident(jsonb_build_object('category', a ->> 'category', 'description', a ->> 'description',
    'pickup_point_id', pp, 'location_text', left(a ->> 'location_text', 200), 'needs_immediate_help', urgent));
  update public.incidents set source = 'ai_assistant_report', occurred_at = occurred,
    approx_lat = coalesce(lat, approx_lat), approx_lng = coalesce(lng, approx_lng),
    geo_precision = case when lat is not null then 'approximate_1km' else geo_precision end
   where reference = res ->> 'reference';

  return jsonb_build_object('reference', res ->> 'reference', 'submission_status', 'received',
    'verification_status', 'unverified', 'tracking_token', res ->> 'access_token',
    'next_steps', to_jsonb(array_remove(array[
      case when urgent then 'If you are in danger now, call 10111 (police) or 112 from a mobile. SafeArrival is not an emergency service.' end,
      'Keep the reference. The SafeArrival safety team reviews reports; this report is unverified until reviewed.',
      'This is NOT a police case number. To open a criminal case, visit a SAPS station and quote what happened.'], null)),
    'data_notice', private.demo_notice());
end $$;

create or replace function private.tool_find_emergency_services(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare lat float8; lng float8; cov text;
begin
  if not private.dataset_on('emergency_contacts') then raise exception 'disabled:emergency_contacts'; end if;
  if a ? 'latitude' then lat := private.num(a, 'latitude', -90, 90); lng := private.num(a, 'longitude', -180, 180); cov := private.coverage_for(lat, lng); end if;
  return jsonb_build_object(
    'immediate_danger', 'If anyone is in immediate danger call 10111 (police), 10177 (ambulance) or 112 from any mobile phone. Do this before anything else.',
    'emergency_numbers', (select jsonb_agg(jsonb_build_object('name', name, 'number', number, 'type', kind, 'region', region, 'notes', notes) order by priority)
                          from public.emergency_contacts where region = 'national' or region = cov or (cov is null and lat is null)),
    'location', jsonb_build_object('coverage_area', cov,
      'note', case when lat is null then 'No location given: national numbers plus local numbers for SafeArrival coverage areas are listed.'
                   when cov is null then 'Outside SafeArrival coverage: national numbers only.' end),
    'nearest_facilities', jsonb_build_object('available', false,
      'note', 'SafeArrival does not hold a verified list of hospitals or police stations. Ask emergency call-takers, your hotel, or use a maps app.'),
    'safearrival_support', jsonb_build_object('is_emergency_service', false,
      'how_to_reach', 'Report transport problems with report_safety_incident or the "Something''s wrong" page. SafeArrival does not dispatch police or ambulances.'),
    'last_updated', (select max(updated_at) from public.emergency_contacts),
    'limitations', jsonb_build_array('Numbers are compiled from public sources and reviewed by SafeArrival; confirm with your hotel if unsure.'));
end $$;

create or replace function private.tool_get_pickup_guidance(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare pp public.pickup_points; h public.hotels; q text := lower(trim(coalesce(a ->> 'pickup_point', ''))); plat float8; plng float8;
begin
  if not private.dataset_on('pickup_points') then raise exception 'disabled:pickup_points'; end if;
  if a ? 'latitude' then plat := private.num(a, 'latitude', -90, 90); plng := private.num(a, 'longitude', -180, 180); end if;
  if nullif(a ->> 'hotel', '') is not null then
    select * into h from public.hotels where status = 'active' and (slug = lower(a ->> 'hotel') or name ilike '%' || replace(a ->> 'hotel', '%', '') || '%') limit 1;
  end if;
  select * into pp from public.pickup_points p
   where (q <> '' and (p.id = q or lower(p.name) like '%' || q || '%'))
      or (q = '' and plat is not null)
      or (q = '' and plat is null and p.id = h.default_pickup_point_id)
   order by case when plat is not null then private.km(plat, plng, p.lat, p.lng) end nulls last limit 1;

  return jsonb_build_object(
    'pickup_point', case when pp.id is not null then jsonb_build_object('id', pp.id, 'name', pp.name, 'type', pp.kind,
      'meeting_instructions', pp.description, 'terminal_info', pp.terminal_info, 'latitude', pp.lat, 'longitude', pp.lng,
      'distance_km', case when plat is not null then round(private.km(plat, plng, pp.lat, pp.lng)::numeric, 1) end) end,
    'all_pickup_points', case when pp.id is null then (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', kind) order by kind, name) from public.pickup_points) end,
    'hotel', case when h.id is not null then jsonb_build_object('name', h.name, 'area', h.area, 'phone', h.phone, 'safearrival_partner', true) end,
    'verification_instructions', jsonb_build_array(
      'Your driver''s name, photo, vehicle and registration are sent to your WhatsApp and booking page once assigned.',
      'At pickup, the DRIVER must say your verification code first (e.g. "BLUE TABLE 47"). Never read it out, show it, or let anyone photograph it.',
      'Check the registration plate before you load luggage.',
      'If anything does not match, do not get in; tap "Something''s wrong" on your booking page.'),
    'impersonation_warnings', jsonb_build_array(
      'People holding a sign with your name can still be impostors; names on signs are easy to copy. The spoken code is the check.',
      'Ignore unsolicited offers of transport inside the terminal. Legitimate drivers wait at the designated pickup point.',
      'No SafeArrival driver will ask for an extra "airport fee" or cash on top of your agreed price.'),
    'recent_reports_at_point', case when pp.id is not null then (select count(*) from private.visible_incidents(30, true) i where i.pickup_point_id = pp.id) end,
    'data_notice', private.demo_notice());
end $$;

create or replace function private.tool_get_travel_safety_advice(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare ctx text := coalesce(nullif(a ->> 'travel_context', ''), 'general'); dest text := trim(coalesce(a ->> 'destination', ''));
  lat float8; lng float8; cov text; c jsonb;
begin
  if not private.dataset_on('safety_advice') then raise exception 'disabled:safety_advice'; end if;
  if ctx not in ('general', 'airport_arrival', 'ehailing', 'shuttle', 'night', 'outdoors') then raise exception 'invalid:Unknown travel_context'; end if;
  if a ? 'latitude' then
    lat := private.num(a, 'latitude', -90, 90); lng := private.num(a, 'longitude', -180, 180); cov := private.coverage_for(lat, lng);
  else
    select x into c from jsonb_array_elements(private.setting('mcp_coverage', '[]')) x where dest ilike '%' || (x ->> 'name') || '%' limit 1;
    cov := c ->> 'name'; lat := (c ->> 'lat')::float8; lng := (c ->> 'lng')::float8;
  end if;
  return jsonb_build_object(
    'destination', nullif(left(dest, 80), ''), 'travel_context', ctx, 'travel_time', left(a ->> 'travel_time', 40),
    'coverage', jsonb_build_object('covered', cov is not null, 'area', cov,
      'note', case when cov is null then 'SafeArrival has no local data for this destination. Only general South Africa guidance is given.' end),
    'precautions', (select jsonb_agg(jsonb_build_object('title', title, 'advice', advice, 'context', context) order by context <> ctx, id)
                    from public.safety_advice where context in (ctx, 'general') or (ctx = 'night' and context = 'ehailing')),
    'common_reported_issues', case when cov is not null then (
       select coalesce(jsonb_agg(jsonb_build_object('category', category, 'label', private.category_label(category), 'reports_last_90_days', n,
         'precaution', private.category_precaution(category)) order by n desc), '[]')
       from (select category, count(*) n from private.visible_incidents(90, true) i
             where i.approx_lat is not null and private.km(lat, lng, i.approx_lat, i.approx_lng) <= 60 group by 1) g) end,
    'active_alerts', case when cov is not null then (select coalesce(jsonb_agg(private.public_incident(i)), '[]')
       from private.visible_incidents(30, false) i where i.public_until >= now()
         and i.approx_lat is not null and private.km(lat, lng, i.approx_lat, i.approx_lng) <= 60) end,
    'emergency', jsonb_build_object('police', '10111', 'ambulance', '10177', 'mobile_emergency', '112'),
    'last_updated', (select max(updated_at) from public.safety_advice),
    'limitations', private.limitations(array['This is general guidance, not a risk assessment of any neighbourhood.']));
end $$;

-- ================================================================ entry point
create or replace function public.mcp_call(p_tool text, p_args jsonb default '{}', p_client text default null, p_client_name text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t0 timestamptz := clock_timestamp(); res jsonb; st text := 'ok'; err text; code text;
  hdr text := nullif(current_setting('request.headers', true), '');
  secret text := case when hdr is not null then hdr::jsonb ->> 'x-mcp-secret' end;
  is_write boolean := p_tool = 'report_safety_incident';
  lim int; win interval; hits int; a jsonb := coalesce(p_args, '{}');
begin
  if p_tool !~ '^[a-z_]{3,40}$' then return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Unknown tool'); end if;
  if secret is null or not exists (select 1 from private.mcp_config where secret_hash = encode(digest(secret, 'sha256'), 'hex')) then
    insert into public.mcp_requests (tool, status) values (p_tool, 'unauthorised');
    return jsonb_build_object('ok', false, 'code', 'unauthorised', 'error', 'This function is reserved for the SafeArrival MCP server');
  end if;

  -- Rate limit per client (the server sends a salted hash of the caller's IP, never the IP).
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
      'error', format('Rate limit reached (%s %s). Please wait and try again. In an emergency call 10111 or 112.', lim, case when is_write then 'reports per hour' else 'requests per minute' end));
  end if;

  begin
    res := case p_tool
      when 'check_area_safety' then private.tool_check_area_safety(a)
      when 'get_safety_alerts' then private.tool_get_safety_alerts(a)
      when 'check_route_safety' then private.tool_check_route_safety(a)
      when 'verify_transport_provider' then private.tool_verify_transport_provider(a)
      when 'verify_driver' then private.tool_verify_driver(a)
      when 'report_safety_incident' then private.tool_report_safety_incident(a)
      when 'find_emergency_services' then private.tool_find_emergency_services(a)
      when 'get_pickup_guidance' then private.tool_get_pickup_guidance(a)
      when 'get_travel_safety_advice' then private.tool_get_travel_safety_advice(a)
    end;
    if res is null then raise exception 'invalid:Unknown tool %', p_tool; end if;
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

-- ================================================================ reference + demo data
insert into public.emergency_contacts (id, name, number, kind, region, notes, priority) values
  ('saps', 'SAPS Police emergency', '10111', 'police', 'national', 'Crime in progress, threats, assault. Free from any phone.', 1),
  ('ems', 'Ambulance & fire (public EMS)', '10177', 'ambulance', 'national', 'Medical emergencies.', 2),
  ('mobile-112', 'Emergency from any mobile', '112', 'all_emergencies', 'national', 'Works from any mobile network, even without airtime; routes to police/ambulance.', 3),
  ('er24', 'ER24 (private ambulance)', '084 124', 'private_ambulance', 'national', 'Private emergency medical service; fees may apply.', 10),
  ('netcare911', 'Netcare 911 (private ambulance)', '082 911', 'private_ambulance', 'national', 'Private emergency medical service; fees may apply.', 11),
  ('gbv', 'Gender-Based Violence Command Centre', '0800 428 428', 'helpline', 'national', '24-hour, toll-free.', 20),
  ('nsri', 'NSRI sea rescue', '087 094 9774', 'sea_rescue', 'national', 'Emergencies at sea, beaches and inland water.', 21),
  ('ct-emergency', 'City of Cape Town emergency line', '107 (landline) / 021 480 7700 (mobile)', 'municipal', 'Cape Town', 'Fire, ambulance and disaster coordination in Cape Town.', 5),
  ('ct-mountain', 'Wilderness Search and Rescue (Table Mountain & Western Cape)', '021 937 0300', 'mountain_rescue', 'Cape Town', 'Hikers lost or injured on mountains.', 22)
on conflict (id) do nothing;

insert into public.safety_advice (id, context, title, advice) values
  ('g-verify', 'general', 'Verify before you get in', 'Whatever the transport, check the driver''s name, photo and the vehicle registration against your booking before getting in. If anything does not match, do not get in.'),
  ('g-share', 'general', 'Share your plans', 'Share your trip or accommodation details with someone you trust, and keep your phone charged.'),
  ('g-report', 'general', 'Report problems', 'Report unexpected payment requests, impostor drivers or intimidation so others can be warned. A report is not a police case: for crimes, visit a SAPS station.'),
  ('a-touts', 'airport_arrival', 'Ignore unsolicited transport offers', 'Decline offers of transport from people who approach you inside the terminal. Use pre-booked transport, official ranks, or app-based rides from the designated pickup zones.'),
  ('a-meet', 'airport_arrival', 'Meet at the designated pickup point', 'Booked drivers wait at the designated transport pickup area, not inside the arrivals hall. A sign with your name is not proof of identity.'),
  ('a-fee', 'airport_arrival', 'No surprise fees', 'You should not be asked for an extra cash "airport fee" on top of an agreed price. Refuse, and report it.'),
  ('e-plate', 'ehailing', 'Match the plate and the app', 'For app-based rides, check the registration, make, colour and the driver''s name and photo in the app before getting in. Ask the driver to say your name before you say it.'),
  ('e-pin', 'ehailing', 'Use the app''s safety features', 'Use in-app trip sharing and any PIN verification the app offers. Stay in the app for payment and communication.'),
  ('s-confirm', 'shuttle', 'Confirm the operator', 'Book shuttles through your accommodation or a known operator, and confirm the price and payment method in writing before pickup.'),
  ('n-wait', 'night', 'Wait somewhere public and lit', 'At night, wait for your ride in a well-lit, busy place or inside your accommodation until the vehicle has arrived and been checked.'),
  ('o-hike', 'outdoors', 'Tell someone your route', 'Before hikes or remote outings, tell someone your route and expected return, go in a group, and save the mountain rescue number.'),
  ('x-emergency', 'emergency', 'In an emergency', 'Call 10111 (police) or 112 from a mobile first. Move to a busy, well-lit public place. SafeArrival is not an emergency service.')
on conflict (id) do nothing;

-- Demo extras on top of the base seed: the safety team has verified a few reports
-- and published one advisory, so AI assistants can show the verified/unverified split.
alter function private.seed_demo_data() rename to seed_demo_core;
create or replace function private.seed_demo_data() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.seed_demo_core();
  update public.incidents set verification_status = 'verified', verified_at = created_at + interval '1 day', public_until = now() + interval '21 days',
    public_summary = case category
      when 'extra_payment' then 'Travellers at the International Arrivals pickup area were asked for an unexpected cash "airport fee" before luggage was loaded. (Demo record)'
      when 'suspected_scam' then 'A person inside the terminal offered a "hotel shuttle" for cash and was not linked to any booking. (Demo record)'
      else private.category_label(category) || ' confirmed by the SafeArrival safety team after review. (Demo record)' end
  where status in ('escalated', 'referred_authorities') or (category = 'extra_payment' and pickup_point_id = 'cpt-intl' and status = 'follow_up');
  update public.incidents set verification_status = 'verified', verified_at = created_at + interval '2 days', public_until = created_at + interval '14 days',
    public_summary = private.category_label(category) || ' (resolved; demo record)'
  where status = 'resolved' and category in ('vehicle_mismatch', 'driver_mismatch');
  insert into public.incidents (reference, category, description, pickup_point_id, status, verification_status, verified_at, public_until,
    public_summary, source, created_at)
  values ('SAFE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.incident_ref_seq')::text, 4, '0'), 'suspected_scam',
    'Advisory issued by the SafeArrival safety team.', 'cpt-intl', 'follow_up', 'official_advisory', now() - interval '2 days', now() + interval '28 days',
    'SafeArrival advisory: several travellers reported unofficial "drivers" approaching arrivals inside the terminal. Only go with a driver who can say your verification code, at the designated pickup point. (Demo advisory)',
    'safearrival_team', now() - interval '2 days');
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
