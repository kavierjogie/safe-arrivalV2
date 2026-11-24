-- 7  Safety-alert subscriptions and notifications.
--
-- Monitoring happens HERE, in the database, not in an AI conversation:
--   incidents (verified / advisory published)  --trigger-->  alert_deliveries (one row per subscription × incident)
--   alert_deliveries INSERT  --Database Webhook-->  whatsapp-webhook/dispatch  (WhatsApp template; see README)
--   channel 'web'  -> shown on /alerts/<manage_token> (a feed today; web push can read the same rows later)
-- Only incidents VERIFIED by the safety team or SafeArrival advisories trigger alerts; unverified reports never do.
-- No tracking of anyone's live location: a subscription is a fixed area the person chose, stored at ~1 km precision.

create table public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  manage_token text not null unique default encode(gen_random_bytes(18), 'hex'),  -- the subscriber's private link
  label text not null check (char_length(label) between 2 and 80),                -- "V&A Waterfront"
  lat double precision check (lat between -90 and 90),                            -- rounded to 2 dp; nulled on unsubscribe
  lng double precision check (lng between -180 and 180),
  radius_km numeric(4, 1) not null check (radius_km between 0.5 and 25),
  categories text[],                                                              -- null = every category
  channel text not null check (channel in ('web', 'whatsapp')),
  whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),                         -- only for channel whatsapp; nulled on unsubscribe
  consent_at timestamptz not null,
  consent_text text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'unsubscribed')),
  source text not null default 'ai_assistant' check (source in ('ai_assistant', 'web')),
  expires_at timestamptz not null,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel <> 'whatsapp' or whatsapp is not null or status = 'unsubscribed')
);
create index alert_subscriptions_active_idx on public.alert_subscriptions (status, expires_at);
create trigger alert_subscriptions_touch before update on public.alert_subscriptions for each row execute function public.touch_updated_at();

create table public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.alert_subscriptions (id) on delete cascade,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  channel text not null,
  -- web: 'delivered' (visible in the feed). whatsapp: 'queued' until the dispatcher reports
  -- 'sent' / 'failed', or 'not_configured' when no approved WhatsApp template is set up.
  delivery_status text not null check (delivery_status in ('delivered', 'queued', 'sent', 'failed', 'not_configured')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, incident_id)                                           -- never alert twice about one incident
);
create index alert_deliveries_created_idx on public.alert_deliveries (created_at desc);

-- No client reads subscriptions (they hold phone numbers). Admins may read delivery rows (no personal data).
alter table public.alert_subscriptions enable row level security;
alter table public.alert_deliveries enable row level security;
create policy alert_deliveries_admin on public.alert_deliveries for select using (app.is_admin());
revoke all on public.alert_subscriptions from anon, authenticated;
grant select on public.alert_deliveries to anon, authenticated;
revoke insert, update, delete, truncate on public.alert_deliveries from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alert_deliveries;
  end if;
end $$;

insert into public.app_settings (key, value) values
  ('public_app_url', '"https://safearrival-one.vercel.app"'),
  ('whatsapp_alerts_enabled', 'false')   -- set true once an approved alert template exists (see README)
on conflict (key) do nothing;

-- ================================================================ matching (the background monitor)
create or replace function private.alert_text(i public.incidents) returns text
language sql stable security definer set search_path = public, extensions as $$
  select format(E'%s\n\n%s\n\nWhere: %s\nReported: %s\nStatus: %s\n\nWhat you can do: %s\n\nIn an emergency call 10111 (police) or 112 from a mobile. SafeArrival is not an emergency service.%s',
    case when i.verification_status = 'official_advisory' then 'SafeArrival safety advisory' else 'SafeArrival alert: verified incident' end,
    coalesce(i.public_summary, private.category_label(i.category)),
    coalesce((select name from public.pickup_points where id = i.pickup_point_id), 'within about 1 km of ' || round(i.approx_lat::numeric, 2) || ', ' || round(i.approx_lng::numeric, 2)),
    private.fmt_time(coalesce(i.occurred_at, i.created_at)),
    case when i.verification_status = 'official_advisory' then 'Advisory published by the SafeArrival safety team'
         else 'Verified by the SafeArrival safety team' end,
    private.category_precaution(i.category),
    coalesce(E'\n\n' || private.demo_notice(), ''))
$$;

create or replace function private.fan_out_alerts() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- Fires on the transition INTO verified/advisory, for recent incidents verified just now
  -- (verified_at is backdated for seeded history, so demo resets never alert anyone).
  if new.verification_status not in ('verified', 'official_advisory')
     or (tg_op = 'UPDATE' and old.verification_status in ('verified', 'official_advisory'))
     or new.approx_lat is null or new.verified_at is null or new.verified_at < now() - interval '10 minutes'
     or new.created_at < now() - interval '30 days' or coalesce(new.public_until, 'infinity') <= now() then
    return new;
  end if;
  insert into public.alert_deliveries (subscription_id, incident_id, channel, delivery_status, title, body)
  select s.id, new.id, s.channel,
    case s.channel when 'web' then 'delivered'
                   else case when private.setting('whatsapp_alerts_enabled', 'false') = 'true'::jsonb then 'queued' else 'not_configured' end end,
    case when new.verification_status = 'official_advisory' then 'Safety advisory near ' else 'Verified incident near ' end || s.label,
    private.alert_text(new)
  from public.alert_subscriptions s
  where s.status = 'active' and s.expires_at > now()
    and private.km(s.lat, s.lng, new.approx_lat, new.approx_lng) <= s.radius_km
    and (s.categories is null or new.category = any (s.categories))
  on conflict (subscription_id, incident_id) do nothing;
  return new;
end $$;
create trigger incidents_fan_out after insert or update of verification_status on public.incidents
  for each row execute function private.fan_out_alerts();

-- ================================================================ subscriber self-service (token = private link)
create or replace function private.subscription_by_token(p_token text) returns public.alert_subscriptions
language plpgsql stable security definer set search_path = public, extensions as $$
declare s public.alert_subscriptions;
begin
  select * into s from public.alert_subscriptions where manage_token = p_token;
  if s.id is null or p_token is null or length(p_token) < 20 then raise exception 'not_found:Alert subscription not found' using errcode = 'P0002'; end if;
  return s;
end $$;

create or replace function private.subscription_json(s public.alert_subscriptions) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'reference', 'ALR-' || upper(left(replace(s.id::text, '-', ''), 8)),
    'area', s.label, 'radius_km', s.radius_km, 'approx_lat', s.lat, 'approx_lng', s.lng,
    'categories', coalesce(to_jsonb(s.categories), '"all"'),
    'channel', s.channel,
    'whatsapp', case when s.whatsapp is not null then left(s.whatsapp, 3) || '•••' || right(s.whatsapp, 3) end,
    'status', case when s.status = 'active' and s.expires_at <= now() then 'expired' else s.status end,
    'expires_at', s.expires_at, 'created_at', s.created_at, 'consent_at', s.consent_at,
    'triggers', 'Incidents verified by the SafeArrival safety team and SafeArrival advisories within your area. Unverified traveller reports never trigger alerts.',
    'whatsapp_delivery', case when s.channel = 'whatsapp' then
      case when private.setting('whatsapp_alerts_enabled', 'false') = 'true'::jsonb then 'enabled'
           else 'not connected yet: alerts are kept on your manage page until SafeArrival''s WhatsApp alert template is approved' end end)
$$;

create or replace function public.get_alert_subscription(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s public.alert_subscriptions := private.subscription_by_token(p_token);
begin
  return jsonb_build_object('subscription', private.subscription_json(s),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('title', d.title, 'body', d.body, 'created_at', d.created_at,
        'delivery_status', d.delivery_status, 'type', i.verification_status, 'category', i.category) order by d.created_at desc)
      from public.alert_deliveries d join public.incidents i on i.id = d.incident_id where d.subscription_id = s.id), '[]'),
    'data_notice', private.demo_notice());
end $$;

create or replace function public.update_alert_subscription(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.alert_subscriptions := private.subscription_by_token(p_token); cats text[];
begin
  if s.status = 'unsubscribed' then raise exception 'invalid:This subscription was cancelled. Create a new one to receive alerts again.'; end if;
  if p ? 'categories' and jsonb_typeof(p -> 'categories') = 'array' then
    select array_agg(x) into cats from jsonb_array_elements_text(p -> 'categories') x;
    if exists (select 1 from unnest(cats) c where c not in ('driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment',
        'suspected_scam', 'intimidation', 'cannot_locate_driver', 'other')) then raise exception 'invalid:Unknown category'; end if;
  end if;
  if p ? 'status' and p ->> 'status' not in ('active', 'paused') then raise exception 'invalid:status must be active or paused'; end if;
  update public.alert_subscriptions set
    radius_km = case when p ? 'radius_km' then private.num(p, 'radius_km', 0.5, 25)::numeric else radius_km end,
    categories = case when p ? 'categories' then (case when jsonb_typeof(p -> 'categories') = 'array' and cardinality(cats) > 0 then cats end) else categories end,
    status = coalesce(p ->> 'status', status),
    expires_at = case when p ? 'extend_days' then now() + make_interval(days => private.num(p, 'extend_days', 1, 30)::int) else expires_at end
  where id = s.id returning * into s;
  return private.subscription_json(s);
end $$;

create or replace function public.unsubscribe_alerts(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.alert_subscriptions := private.subscription_by_token(p_token);
begin
  -- Data minimisation: the phone number and location are deleted, not just hidden.
  update public.alert_subscriptions set status = 'unsubscribed', unsubscribed_at = coalesce(unsubscribed_at, now()),
    whatsapp = null, lat = null, lng = null where id = s.id returning * into s;
  return private.subscription_json(s);
end $$;

-- ================================================================ MCP tools
create or replace function private.tool_subscribe_safety_alerts(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  lat float8 := round(private.num(a, 'latitude', -90, 90)::numeric, 2); lng float8 := round(private.num(a, 'longitude', -180, 180)::numeric, 2);
  r float8 := private.num(a, 'radius_km', 0.5, 25, 3); days int := private.num(a, 'duration_days', 1, 30, 14)::int;
  ch text := coalesce(nullif(a ->> 'channel', ''), 'web'); wa text := regexp_replace(coalesce(a ->> 'whatsapp_number', ''), '[\s()-]', '', 'g');
  label text := left(trim(coalesce(a ->> 'location_name', '')), 80); cov text := private.coverage_for(lat, lng); cats text[]; s public.alert_subscriptions;
begin
  if coalesce((a ->> 'consent')::boolean, false) is not true then
    raise exception 'invalid:The user must explicitly consent to receive safety alerts. Explain what they will receive, then call again with consent=true';
  end if;
  if cov is null then raise exception 'invalid:SafeArrival has no data coverage there yet, so alerts would never arrive. Coverage today: Cape Town.'; end if;
  if char_length(label) < 2 then raise exception 'invalid:location_name is required (e.g. "V&A Waterfront")'; end if;
  if ch not in ('web', 'whatsapp') then raise exception 'invalid:channel must be web or whatsapp'; end if;
  if ch = 'whatsapp' and wa !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid:whatsapp_number must be in international format, e.g. +44 7700 900123'; end if;
  if jsonb_typeof(a -> 'categories') = 'array' and jsonb_array_length(a -> 'categories') > 0 then
    select array_agg(x) into cats from jsonb_array_elements_text(a -> 'categories') x;
    if exists (select 1 from unnest(cats) c where c not in ('driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment',
        'suspected_scam', 'intimidation', 'cannot_locate_driver', 'other')) then raise exception 'invalid:Unknown category'; end if;
  end if;
  if ch = 'whatsapp' and (select count(*) from public.alert_subscriptions where whatsapp = wa and status <> 'unsubscribed') >= 5 then
    raise exception 'invalid:This number already has 5 active alert subscriptions';
  end if;

  insert into public.alert_subscriptions (label, lat, lng, radius_km, categories, channel, whatsapp, consent_at, consent_text, expires_at)
  values (label, lat, lng, r, cats, ch, case when ch = 'whatsapp' then wa end, now(),
    format('Consented via an AI assistant to %s safety alerts for %s (%s km) until %s. Unsubscribe any time.',
      case ch when 'whatsapp' then 'WhatsApp' else 'web' end, label, r, to_char(now() + make_interval(days => days), 'YYYY-MM-DD')),
    now() + make_interval(days => days))
  returning * into s;

  return private.subscription_json(s) || jsonb_build_object(
    'subscription_status', 'active',
    'manage_url', (private.setting('public_app_url', '""') #>> '{}') || '/alerts/' || s.manage_token,
    'next_steps', jsonb_build_array(
      'Share the manage link with the user: it shows alerts and lets them pause, change or unsubscribe. Anyone with the link can manage the subscription.',
      'SafeArrival monitors this area itself; the user does not need to keep this conversation open.',
      'Alerts are not an emergency service: in danger call 10111 or 112.'));
end $$;

create or replace function private.tool_manage_safety_alerts(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare tok text := a ->> 'manage_token'; act text := coalesce(a ->> 'action', 'view');
begin
  if tok is null or tok !~ '^[0-9a-f]{20,64}$' then raise exception 'invalid:manage_token is the code at the end of the alerts manage link'; end if;
  return case act
    when 'view' then public.get_alert_subscription(tok)
    when 'pause' then public.update_alert_subscription(tok, '{"status": "paused"}')
    when 'resume' then public.update_alert_subscription(tok, '{"status": "active"}')
    when 'update' then public.update_alert_subscription(tok, a - 'manage_token' - 'action')
    when 'unsubscribe' then public.unsubscribe_alerts(tok)
    else null end;
end $$;

-- ================================================================ entry point: dynamic dispatch
-- Same contract as migration 6, but tools are found by name (private.tool_<name>(jsonb)),
-- so new tools need no change here. Writes use the stricter rate-limit bucket.
create or replace function public.mcp_call(p_tool text, p_args jsonb default '{}', p_client text default null, p_client_name text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t0 timestamptz := clock_timestamp(); res jsonb; st text := 'ok'; err text; code text;
  hdr text := nullif(current_setting('request.headers', true), '');
  secret text := case when hdr is not null then hdr::jsonb ->> 'x-mcp-secret' end;
  is_write boolean := p_tool in ('report_safety_incident', 'subscribe_safety_alerts');
  lim int; win interval; hits int; a jsonb := coalesce(p_args, '{}');
begin
  if p_tool !~ '^[a-z_]{3,40}$' or to_regprocedure(format('private.%I(jsonb)', 'tool_' || p_tool)) is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Unknown tool');
  end if;
  if secret is null or not exists (select 1 from private.mcp_config where secret_hash = encode(digest(secret, 'sha256'), 'hex')) then
    insert into public.mcp_requests (tool, status) values (p_tool, 'unauthorised');
    return jsonb_build_object('ok', false, 'code', 'unauthorised', 'error', 'This function is reserved for the SafeArrival MCP server');
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

revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
