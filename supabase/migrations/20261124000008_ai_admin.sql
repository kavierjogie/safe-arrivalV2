-- 8  Admin "AI integrations": aggregate usage and data controls for the MCP service.
-- Aggregates only. No arguments, IPs or phone numbers are stored or returned (see migrations 6 and 7).

create or replace function private.client_family(ua text) returns text
language sql immutable as $$
  select case when ua is null then 'Unknown'
              when ua ilike 'claude%' then 'Claude'
              when ua ilike 'openai%' or ua ilike '%chatgpt%' then 'ChatGPT'
              when ua ilike 'cursor%' then 'Cursor'
              when ua ilike '%vscode%' or ua ilike '%copilot%' then 'VS Code'
              when ua ilike 'node%' or ua ilike '%undici%' then 'SDK / scripts'
              when ua = 'stdio' then 'Local (stdio)'
              else 'Other' end
$$;

create or replace function public.admin_ai_overview() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  perform private.require_admin();
  with req as (select * from public.mcp_requests where coalesce(client_name, '') <> 'health-check'),
       wk as (select * from req where created_at > now() - interval '7 days')
  select jsonb_build_object(
    'generated_at', now(),
    'demo_mode', private.setting('demo_mode', 'false') = 'true'::jsonb,
    'requests', jsonb_build_object(
      'total', (select count(*) from req),
      'last_24h', (select count(*) from req where created_at > now() - interval '24 hours'),
      'last_7d', (select count(*) from wk),
      'errors_7d', (select count(*) from wk where status in ('error', 'invalid')),
      'rate_limited_7d', (select count(*) from wk where status = 'rate_limited'),
      'unauthorised_7d', (select count(*) from wk where status = 'unauthorised'),
      'avg_ms_7d', (select round(avg(duration_ms)) from wk where status = 'ok'),
      'last_at', (select max(created_at) from req),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('name', to_char(d, 'DD Mon'), 'value', n) order by d), '[]') from (
          select g::date d, (select count(*) from req where created_at::date = g::date) n
          from generate_series(current_date - 13, current_date, interval '1 day') g) x),
      'by_tool', (select coalesce(jsonb_agg(jsonb_build_object('tool', tool, 'calls', n, 'ok', ok, 'errors', er, 'rate_limited', rl, 'avg_ms', ms) order by n desc), '[]') from (
          select tool, count(*) n, count(*) filter (where status = 'ok') ok, count(*) filter (where status in ('error', 'invalid')) er,
                 count(*) filter (where status = 'rate_limited') rl, round(avg(duration_ms) filter (where status = 'ok')) ms
          from wk where status <> 'unauthorised' group by tool) t),
      'by_client', (select coalesce(jsonb_agg(jsonb_build_object('name', c, 'value', n) order by n desc), '[]') from (
          select private.client_family(client_name) c, count(*) n from wk where status <> 'unauthorised' group by 1) t),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'tool', tool, 'status', status, 'client', private.client_family(client_name),
                   'area', case when area_lat is not null then area_lat || ', ' || area_lng end, 'ms', duration_ms) order by id desc), '[]')
                 from (select * from req order by id desc limit 25) t)),
    'reports', jsonb_build_object(
      'from_ai_7d', (select count(*) from public.incidents where source = 'ai_assistant_report' and created_at > now() - interval '7 days'),
      'from_ai_total', (select count(*) from public.incidents where source = 'ai_assistant_report'),
      'by_verification', (select coalesce(jsonb_object_agg(verification_status, n), '{}') from (select verification_status, count(*) n from public.incidents group by 1) t),
      'awaiting_review', (select count(*) from public.incidents where verification_status = 'unverified' and status not in ('resolved', 'closed'))),
    'subscriptions', jsonb_build_object(
      'active', (select count(*) from public.alert_subscriptions where status = 'active' and expires_at > now()),
      'paused', (select count(*) from public.alert_subscriptions where status = 'paused'),
      'expired', (select count(*) from public.alert_subscriptions where status = 'active' and expires_at <= now()),
      'unsubscribed', (select count(*) from public.alert_subscriptions where status = 'unsubscribed'),
      'by_channel', (select coalesce(jsonb_object_agg(channel, n), '{}') from (select channel, count(*) n from public.alert_subscriptions where status <> 'unsubscribed' group by 1) t)),
    'deliveries', jsonb_build_object(
      'last_7d', (select count(*) from public.alert_deliveries where created_at > now() - interval '7 days'),
      'by_status', (select coalesce(jsonb_object_agg(delivery_status, n), '{}') from (select delivery_status, count(*) n from public.alert_deliveries group by 1) t),
      'whatsapp_enabled', private.setting('whatsapp_alerts_enabled', 'false') = 'true'::jsonb),
    'freshness', jsonb_build_object(
      'latest_report', (select max(created_at) from public.incidents),
      'latest_verification', (select max(verified_at) from public.incidents),
      'emergency_contacts', (select max(updated_at) from public.emergency_contacts),
      'safety_advice', (select max(updated_at) from public.safety_advice),
      'pickup_points', (select count(*) from public.pickup_points)),
    'datasets', private.setting('mcp_datasets', '{}'),
    'coverage', private.setting('mcp_coverage', '[]')) into r;
  return r;
end $$;

-- Switch a dataset on/off for public MCP clients. Takes effect on the next tool call; no deploy.
create or replace function public.set_mcp_dataset(p_key text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  if p_key not in ('incident_reports', 'advisories', 'pickup_points', 'providers', 'emergency_contacts', 'safety_advice') then
    raise exception 'Unknown dataset';
  end if;
  if p_enabled is null then raise exception 'Choose on or off'; end if;
  update public.app_settings set value = jsonb_set(value, array[p_key], to_jsonb(p_enabled)), updated_at = now() where key = 'mcp_datasets';
  perform private.audit('set_mcp_dataset', 'app_settings', null, jsonb_build_object('dataset', p_key, 'enabled', p_enabled));
  return private.setting('mcp_datasets', '{}');
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
