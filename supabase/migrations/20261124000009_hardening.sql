-- 9  Hardening from the Supabase security advisor.
-- 1. Pin search_path on helper functions that didn't set one (function_search_path_mutable),
--    so an object in a caller's schema can never shadow what they reference.
-- 2. Trigger functions are not API endpoints: revoke direct EXECUTE (triggers still fire;
--    PostgreSQL doesn't check EXECUTE when a trigger runs).
-- Intentionally unchanged: public RPCs are SECURITY DEFINER and callable by anon/authenticated by
-- design (RPC-only writes); each checks the caller's role, token or the MCP server secret itself.

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'app') and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', f);
  end loop;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
