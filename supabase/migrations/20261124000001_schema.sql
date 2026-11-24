-- Safe Arrival CPT — trusted tourist transport & safety platform
-- 1/4  Schema: tables, constraints, indexes, timestamps.
-- Runs unchanged on Supabase and in the in-browser demo database (PGlite).

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- settings
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- partners
create table public.pickup_points (
  id text primary key,                       -- e.g. 'cpt-intl'
  name text not null,
  kind text not null check (kind in ('airport', 'station', 'hotel', 'other')),
  description text not null,                 -- where exactly to meet
  terminal_info text,
  lat double precision not null,
  lng double precision not null
);

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),   -- used in /start?hotel=<slug>
  name text not null check (char_length(name) between 2 and 120),
  area text not null,
  address text,
  phone text,
  email text,
  short_code text unique check (short_code ~ '^[a-z0-9]{2,12}$'),   -- /s/<code> short link printed under the QR
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  default_pickup_point_id text references public.pickup_points (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transport_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  provider_type text not null check (provider_type in ('hotel_fleet', 'shuttle', 'ehailing')),
  integration text not null default 'manual' check (integration in ('manual', 'uber_central')),
  owner_hotel_id uuid references public.hotels (id) on delete set null,   -- set for a hotel's own fleet
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  contact_phone text,
  contact_email text,
  safety_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_service_areas (
  provider_id uuid not null references public.transport_providers (id) on delete cascade,
  area text not null,
  primary key (provider_id, area)
);

-- A transport option a hotel offers its guests, with the price arrangement.
create table public.hotel_transport_partners (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  provider_id uuid not null references public.transport_providers (id) on delete cascade,
  vehicle_class text not null,               -- 'Sedan', 'Minibus' …
  passenger_capacity int not null check (passenger_capacity between 1 and 22),
  luggage_capacity int not null check (luggage_capacity between 0 and 30),
  price_type text not null check (price_type in ('agreed', 'estimate', 'on_request')),
  price_amount numeric(10, 2) check (price_amount >= 0),
  price_min numeric(10, 2) check (price_min >= 0),
  price_max numeric(10, 2) check (price_max >= price_min),
  payment_arrangement text not null,         -- shown to the tourist before confirming
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, provider_id, vehicle_class),
  check ((price_type = 'agreed' and price_amount is not null)
      or (price_type = 'estimate' and price_min is not null and price_max is not null)
      or price_type = 'on_request')
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.transport_providers (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  photo_path text,                           -- private storage path (signed URLs only)
  phone text,                                -- never exposed publicly
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  review_note text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.transport_providers (id) on delete cascade,
  make text not null,
  model text not null,
  colour text not null,
  registration text not null unique check (char_length(registration) between 4 and 15),
  vehicle_class text not null,
  seats int not null check (seats between 1 and 22),
  luggage int not null check (luggage between 0 and 30),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- people
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'tourist' check (role in ('tourist', 'hotel_staff', 'provider_staff', 'driver', 'admin')),
  hotel_id uuid references public.hotels (id) on delete set null,
  provider_id uuid references public.transport_providers (id) on delete set null,
  driver_id uuid references public.drivers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'hotel_staff' or hotel_id is not null),
  check (role <> 'provider_staff' or provider_id is not null),
  check (role <> 'driver' or driver_id is not null)
);

create table public.tourists (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 60),
  whatsapp text not null unique check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),   -- E.164
  user_id uuid references auth.users (id) on delete set null,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'fr', 'de', 'es', 'zh')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- bookings
create sequence public.booking_ref_seq;
create sequence public.incident_ref_seq;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,            -- CT-TRIP-2026-001
  tourist_id uuid not null references public.tourists (id),
  hotel_id uuid not null references public.hotels (id),
  provider_id uuid references public.transport_providers (id),
  partner_id uuid references public.hotel_transport_partners (id),
  transport_type text not null check (transport_type in ('hotel', 'shuttle', 'ehailing')),
  pickup_point_id text not null references public.pickup_points (id),
  destination text not null check (char_length(destination) between 2 and 200),
  pickup_at timestamptz not null,
  flight_number text check (flight_number ~ '^[A-Z0-9]{2,8}$'),
  passengers int not null check (passengers between 1 and 12),
  luggage int not null default 0 check (luggage between 0 and 20),
  vehicle_class text,
  price_type text not null check (price_type in ('agreed', 'estimate', 'on_request')),
  price_amount numeric(10, 2),
  price_min numeric(10, 2),
  price_max numeric(10, 2),
  price_confirmed boolean not null default false,
  payment_arrangement text,
  status text not null default 'pending' check (status in (
    'pending', 'awaiting_provider', 'confirmed', 'driver_assigned', 'driver_on_way',
    'driver_arrived', 'in_progress', 'completed', 'cancelled')),
  status_note text,
  external_ref text,                         -- provider-side booking id (e.g. Uber trip id)
  external_simulated boolean not null default false,
  source text not null default 'web' check (source in ('web', 'whatsapp', 'qr_hotel', 'qr_airport', 'email_link')),
  cancel_reason text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_hotel_idx on public.bookings (hotel_id, pickup_at desc);
create index bookings_provider_idx on public.bookings (provider_id, pickup_at desc);
create index bookings_tourist_idx on public.bookings (tourist_id);
create index bookings_status_idx on public.bookings (status);

-- The tourist's private link token lives apart from `bookings` so that staff,
-- who can read bookings, can never obtain it (it unlocks the live code).
create table public.booking_tokens (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now()
);

create table public.booking_drivers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  driver_id uuid not null references public.drivers (id),
  vehicle_id uuid not null references public.vehicles (id),
  assigned_by uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  assigned_at timestamptz not null default now()
);
create unique index booking_drivers_one_active on public.booking_drivers (booking_id) where active;
create index booking_drivers_driver_idx on public.booking_drivers (driver_id) where active;

-- One-time codes. Only a SHA-256 hash is stored; no RLS policy grants
-- SELECT to anyone, so hashes are readable only inside security-definer RPCs.
create table public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  code_hash text not null unique,            -- unique ⇒ a code is never reissued
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index verification_codes_one_active on public.verification_codes (booking_id) where status = 'active';

create table public.verification_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  outcome text not null check (outcome in (
    'verified', 'code_mismatch', 'details_mismatch', 'wrong_vehicle', 'cannot_find',
    'spoken_code_match', 'spoken_code_mismatch')),
  created_at timestamptz not null default now()
);
create index verification_attempts_booking_idx on public.verification_attempts (booking_id, created_at desc);

-- ---------------------------------------------------------------- incidents
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,            -- SAFE-2026-0001 (internal, never a SAPS number)
  access_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  booking_id uuid references public.bookings (id) on delete set null,
  hotel_id uuid references public.hotels (id) on delete set null,
  provider_id uuid references public.transport_providers (id) on delete set null,
  tourist_id uuid references public.tourists (id) on delete set null,
  category text not null check (category in (
    'driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam',
    'intimidation', 'cannot_locate_driver', 'other')),
  description text check (char_length(description) <= 2000),
  pickup_point_id text references public.pickup_points (id),
  location_text text check (char_length(location_text) <= 200),
  needs_immediate_help boolean not null default false,
  status text not null default 'received' check (status in (
    'received', 'hotel_notified', 'hotel_pending', 'provider_notified', 'escalated',
    'referred_authorities', 'follow_up', 'resolved', 'closed')),
  handler_id uuid references public.profiles (id) on delete set null,
  police_case_number text check (char_length(police_case_number) <= 40),  -- external, supplied by the tourist
  police_station text check (char_length(police_station) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index incidents_hotel_idx on public.incidents (hotel_id, created_at desc);
create index incidents_provider_idx on public.incidents (provider_id, created_at desc);
create index incidents_status_idx on public.incidents (status);
create index incidents_created_idx on public.incidents (created_at desc);

create table public.incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  status text,                               -- null for a plain note
  message text not null check (char_length(message) between 1 and 2000),
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  author_id uuid references public.profiles (id) on delete set null,
  author_label text not null default 'System',
  created_at timestamptz not null default now()
);
create index incident_updates_incident_idx on public.incident_updates (incident_id, created_at);

create table public.incident_evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  storage_path text not null,                -- private bucket path (demo mode: small data URL)
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- messaging & audit
-- Outbound messages. WhatsApp rows are the simulated outbox in the demo and
-- the delivery log in production. Codes in `payload` are redacted as soon as
-- the code is used, expires or is revoked.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'email', 'dashboard')),
  recipient_type text not null check (recipient_type in ('tourist', 'driver', 'hotel', 'provider', 'admin')),
  hotel_id uuid references public.hotels (id) on delete cascade,
  provider_id uuid references public.transport_providers (id) on delete cascade,
  driver_id uuid references public.drivers (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  incident_id uuid references public.incidents (id) on delete cascade,
  kind text not null,                        -- booking_received, driver_assigned, incident_update …
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'simulated' check (delivery_status in ('simulated', 'queued', 'sent', 'failed')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_booking_idx on public.notifications (booking_id, created_at);
create index notifications_hotel_idx on public.notifications (hotel_id, created_at desc) where recipient_type = 'hotel';
create index notifications_provider_idx on public.notifications (provider_id, created_at desc) where recipient_type = 'provider';
create index notifications_driver_idx on public.notifications (driver_id, created_at desc) where recipient_type = 'driver';

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_label text,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- WhatsApp conversation state (written only by the webhook with the service role).
create table public.whatsapp_sessions (
  wa_id text primary key,
  state text not null default 'WELCOME',
  context jsonb not null default '{}'::jsonb,
  last_message_id text,                      -- de-duplicates Meta's webhook retries
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- triggers
do $$
declare t text;
begin
  foreach t in array array['hotels', 'transport_providers', 'hotel_transport_partners', 'drivers', 'vehicles',
                           'profiles', 'tourists', 'bookings', 'incidents']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
