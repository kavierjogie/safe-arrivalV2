-- 2/4  Security: role helpers, Row Level Security, grants, realtime.
--
-- Model: every table is readable only through RLS, and NOTHING is writable
-- directly by anon/authenticated. All writes go through the security-definer
-- RPCs in migration 3, which validate input, check the caller's role and
-- write audit entries. Tourists have no login: they hold an unguessable
-- access token (their WhatsApp link) that the RPCs accept.

create schema if not exists app;

create or replace function app.profile() returns public.profiles
language sql stable security definer set search_path = public, extensions as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function app.role() returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select role from public.profiles where id = auth.uid()), case when auth.uid() is null then 'anon' else 'tourist' end)
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$ select app.role() = 'admin' $$;

create or replace function app.my_hotel() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select hotel_id from public.profiles where id = auth.uid() and role = 'hotel_staff'
$$;

create or replace function app.my_provider() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select provider_id from public.profiles where id = auth.uid() and role = 'provider_staff'
$$;

create or replace function app.my_driver() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select driver_id from public.profiles where id = auth.uid() and role = 'driver'
$$;

-- Can the caller see this booking? (Used by child-table policies.)
create or replace function app.can_see_booking(b uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.bookings x
    left join public.tourists t on t.id = x.tourist_id
    where x.id = b and (
      app.is_admin()
      or x.hotel_id = app.my_hotel()
      or x.provider_id = app.my_provider()
      or (t.user_id is not null and t.user_id = auth.uid())
      or exists (select 1 from public.booking_drivers bd where bd.booking_id = x.id and bd.active and bd.driver_id = app.my_driver())
    )
  )
$$;

create or replace function app.can_see_incident(i uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.incidents x
    left join public.tourists t on t.id = x.tourist_id
    where x.id = i and (
      app.is_admin() or x.hotel_id = app.my_hotel() or x.provider_id = app.my_provider()
      or (t.user_id is not null and t.user_id = auth.uid())
    )
  )
$$;

-- Hotels see drivers/vehicles of their partner providers (needed to assign).
create or replace function app.is_partner_provider(p uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.hotel_transport_partners where hotel_id = app.my_hotel() and provider_id = p)
      or exists (select 1 from public.transport_providers where id = p and owner_hotel_id = app.my_hotel())
$$;

grant usage on schema app to anon, authenticated;
grant execute on all functions in schema app to anon, authenticated;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['app_settings', 'pickup_points', 'hotels', 'transport_providers', 'provider_service_areas',
    'hotel_transport_partners', 'drivers', 'vehicles', 'profiles', 'tourists', 'bookings', 'booking_tokens', 'booking_drivers',
    'verification_codes', 'verification_attempts', 'incidents', 'incident_updates', 'incident_evidence',
    'notifications', 'audit_logs', 'whatsapp_sessions']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Public directory data (needed to book without an account).
create policy pickup_points_read on public.pickup_points for select using (true);
create policy hotels_read on public.hotels for select using (status = 'active' or app.is_admin() or id = app.my_hotel());
create policy providers_read on public.transport_providers for select
  using (status = 'active' or app.is_admin() or id = app.my_provider());
create policy service_areas_read on public.provider_service_areas for select using (true);
create policy partners_read on public.hotel_transport_partners for select
  using (available or app.is_admin() or hotel_id = app.my_hotel() or provider_id = app.my_provider());
create policy settings_admin on public.app_settings for select using (app.is_admin());

-- Drivers & vehicles: never public.
create policy drivers_read on public.drivers for select using (
  app.is_admin() or provider_id = app.my_provider() or id = app.my_driver()
  or (app.is_partner_provider(provider_id) and (status = 'approved'
      or exists (select 1 from public.transport_providers tp where tp.id = drivers.provider_id and tp.owner_hotel_id = app.my_hotel()))));
create policy vehicles_read on public.vehicles for select using (
  app.is_admin() or provider_id = app.my_provider() or app.is_partner_provider(provider_id)
  or exists (select 1 from public.booking_drivers bd where bd.vehicle_id = vehicles.id and bd.active and bd.driver_id = app.my_driver()));

create policy profiles_read on public.profiles for select using (id = auth.uid() or app.is_admin());

create policy tourists_read on public.tourists for select using (
  app.is_admin() or user_id = auth.uid()
  or exists (select 1 from public.bookings b where b.tourist_id = tourists.id
             and (b.hotel_id = app.my_hotel() or b.provider_id = app.my_provider())));

create policy bookings_read on public.bookings for select using (app.can_see_booking(id));
create policy booking_drivers_read on public.booking_drivers for select using (app.can_see_booking(booking_id));
create policy attempts_read on public.verification_attempts for select using (app.can_see_booking(booking_id));
-- booking_tokens, verification_codes, whatsapp_sessions: no policies ⇒ no direct access at all.

create policy incidents_read on public.incidents for select using (app.can_see_incident(id));
create policy incident_updates_read on public.incident_updates for select using (
  app.can_see_incident(incident_id) and (visibility = 'public' or app.role() in ('admin', 'hotel_staff', 'provider_staff')));
create policy incident_evidence_read on public.incident_evidence for select using (
  app.can_see_incident(incident_id) and app.role() in ('admin', 'hotel_staff', 'provider_staff'));

-- Messages: tourist and driver WhatsApp rows can carry a live code, so each
-- recipient sees only their own; admins see dashboard alerts, not codes.
create policy notifications_read on public.notifications for select using (
  (recipient_type = 'hotel' and hotel_id = app.my_hotel())
  or (recipient_type = 'provider' and provider_id = app.my_provider())
  or (recipient_type = 'driver' and driver_id = app.my_driver())
  or (recipient_type = 'admin' and app.is_admin()));

create policy audit_read on public.audit_logs for select using (app.is_admin());

-- ---------------------------------------------------------------- grants
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke select on public.booking_tokens, public.verification_codes, public.whatsapp_sessions from anon, authenticated;

-- New Supabase Auth users get a tourist profile; staff roles are granted by an admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), 'tourist')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Realtime (Supabase only; the publication doesn't exist in the demo database).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bookings, public.booking_drivers, public.incidents,
      public.incident_updates, public.notifications, public.verification_attempts, public.drivers,
      public.hotels, public.transport_providers;
  end if;
end $$;
