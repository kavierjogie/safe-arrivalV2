-- 3/4  Business logic. Every write in the app goes through these functions.
-- `private.*` helpers are not callable by clients.

create schema if not exists private;
revoke all on schema private from public;

-- ================================================================ helpers
create or replace function private.setting(k text, fallback jsonb) returns jsonb
language sql stable as $$ select coalesce((select value from public.app_settings where key = k), fallback) $$;

create or replace function private.actor_label() returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select coalesce(full_name, email) || ' · ' || replace(role, '_', ' ') from public.profiles where id = auth.uid()),
    'Tourist')
$$;

create or replace function private.audit(p_action text, p_entity text, p_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.audit_logs (actor_id, actor_label, action, entity, entity_id, details)
  values (auth.uid(), private.actor_label(), p_action, p_entity, p_id, p_details)
$$;

create or replace function private.notify(
  p_channel text, p_recipient text, p_kind text, p_title text, p_body text,
  p_booking uuid default null, p_incident uuid default null, p_hotel uuid default null,
  p_provider uuid default null, p_driver uuid default null, p_payload jsonb default '{}')
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.notifications (channel, recipient_type, kind, title, body, booking_id, incident_id, hotel_id, provider_id, driver_id, payload)
  values (p_channel, p_recipient, p_kind, p_title, p_body, p_booking, p_incident, p_hotel, p_provider, p_driver, coalesce(p_payload, '{}'))
$$;

create or replace function private.fmt_time(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'Africa/Johannesburg', 'Dy DD Mon, HH24:MI') $$;

create or replace function private.price_text(b public.bookings) returns text
language sql stable as $$
  select case
    when b.price_type = 'agreed' and b.price_confirmed then 'R' || to_char(b.price_amount, 'FM999G990') || ' — confirmed agreed price'
    when b.price_type = 'agreed' then 'R' || to_char(b.price_amount, 'FM999G990') || ' — agreed price, awaiting confirmation'
    when b.price_type = 'estimate' then 'R' || to_char(b.price_min, 'FM999G990') || '–R' || to_char(b.price_max, 'FM999G990') || ' — estimate, final fare may differ'
    else 'Price to be confirmed by the provider before pickup'
  end
$$;

-- Clears a code from every message once it stops being valid.
create or replace function private.redact_codes(p_booking uuid) returns void
language sql security definer set search_path = public, extensions as $$
  update public.notifications
     set body = replace(body, payload ->> 'code', '[code no longer valid]'), payload = payload - 'code'
   where booking_id = p_booking and payload ? 'code'
$$;

create or replace function private.end_code(p_booking uuid, p_status text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.verification_codes set status = p_status, used_at = case when p_status = 'used' then now() end
   where booking_id = p_booking and status = 'active';
  perform private.redact_codes(p_booking);
end $$;

create or replace function private.expire_codes(p_booking uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from public.verification_codes where booking_id = p_booking and status = 'active' and expires_at < now()) then
    perform private.end_code(p_booking, 'expired');
  end if;
end $$;

create or replace function private.normalise_code(c text) returns text
language sql immutable as $$ select upper(regexp_replace(trim(coalesce(c, '')), '[^A-Za-z0-9]+', ' ', 'g')) $$;

create or replace function private.hash_code(c text) returns text
language sql immutable set search_path = public, extensions as $$ select encode(digest('safe-arrival:' || private.normalise_code(c), 'sha256'), 'hex') $$;

-- Generates a fresh, never-used code like "BLUE TABLE 47".
create or replace function private.new_code() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  a text[] := array['BLUE','RED','GREEN','GOLD','SILVER','ORANGE','PURPLE','AMBER','CORAL','OCEAN','SUNNY','STONE','OLIVE','PEARL','CEDAR','MAPLE'];
  n text[] := array['TABLE','MOUNTAIN','RIVER','LION','PENGUIN','PROTEA','HARBOUR','LIGHTHOUSE','ANCHOR','KITE','WHALE','GARDEN','BRIDGE','LANTERN','CANVAS','ROCKET'];
  r bytea; c text;
begin
  for i in 1..50 loop
    r := gen_random_bytes(3);
    c := a[1 + get_byte(r, 0) % 16] || ' ' || n[1 + get_byte(r, 1) % 16] || ' ' || (10 + get_byte(r, 2) % 90)::text;
    if not exists (select 1 from public.verification_codes where code_hash = private.hash_code(c)) then return c; end if;
  end loop;
  raise exception 'Could not generate a unique verification code';
end $$;

create or replace function private.booking_by_token(p_token text) returns public.bookings
language plpgsql stable security definer set search_path = public, extensions as $$
declare b public.bookings;
begin
  select b2.* into b from public.bookings b2 join public.booking_tokens t on t.booking_id = b2.id where t.token = p_token;
  if not found or p_token is null or length(p_token) < 20 then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  return b;
end $$;

-- Raises unless the caller is admin, staff of the booking's hotel/provider, or (optionally) its assigned driver.
create or replace function private.require_booking_staff(b public.bookings, allow_driver boolean default false) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text := app.role();
begin
  if r = 'admin' then return r; end if;
  if r = 'hotel_staff' and b.hotel_id = app.my_hotel() then return r; end if;
  if r = 'provider_staff' and b.provider_id = app.my_provider() then return r; end if;
  if allow_driver and r = 'driver' and exists (
    select 1 from public.booking_drivers where booking_id = b.id and active and driver_id = app.my_driver()) then return r; end if;
  raise exception 'Not authorised for this booking' using errcode = '42501';
end $$;

create or replace function private.require_incident_staff(i public.incidents) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare r text := app.role();
begin
  if r = 'admin' or (r = 'hotel_staff' and i.hotel_id = app.my_hotel()) or (r = 'provider_staff' and i.provider_id = app.my_provider()) then
    return r;
  end if;
  raise exception 'Not authorised for this incident' using errcode = '42501';
end $$;

create or replace function private.require_admin() returns void
language plpgsql stable as $$
begin
  if not app.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
end $$;

-- Assigns a driver + vehicle and issues a new one-time code.
-- The plaintext code goes ONLY to the tourist's and driver's WhatsApp messages.
create or replace function private.do_assign(b public.bookings, p_driver uuid, p_vehicle uuid) returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  d public.drivers; v public.vehicles; p public.transport_providers; pp public.pickup_points; t public.tourists;
  code text; exp timestamptz; uber_note text := '';
begin
  if b.status not in ('confirmed', 'driver_assigned', 'driver_on_way') then
    raise exception 'Booking must be confirmed before a driver is assigned (current status: %)', b.status;
  end if;
  select * into d from public.drivers where id = p_driver;
  select * into v from public.vehicles where id = p_vehicle;
  if d.id is null or d.status <> 'approved' then raise exception 'Driver is not approved'; end if;
  if v.id is null or v.status <> 'active' then raise exception 'Vehicle is not active'; end if;
  if d.provider_id <> b.provider_id or v.provider_id <> b.provider_id then
    raise exception 'Driver and vehicle must belong to the booking''s transport provider';
  end if;
  if v.seats < b.passengers then raise exception 'Vehicle has % seats but the booking has % passengers', v.seats, b.passengers; end if;

  select * into p from public.transport_providers where id = b.provider_id;
  select * into pp from public.pickup_points where id = b.pickup_point_id;
  select * into t from public.tourists where id = b.tourist_id;

  update public.booking_drivers set active = false where booking_id = b.id and active;
  perform private.end_code(b.id, 'revoked');
  insert into public.booking_drivers (booking_id, driver_id, vehicle_id, assigned_by) values (b.id, p_driver, p_vehicle, auth.uid());

  code := private.new_code();
  exp := greatest(now(), b.pickup_at) + make_interval(mins => (private.setting('code_ttl_minutes', '180'))::text::int);
  insert into public.verification_codes (booking_id, code_hash, expires_at) values (b.id, private.hash_code(code), exp);
  update public.bookings set status = 'driver_assigned', status_note = null where id = b.id;

  if p.integration = 'uber_central' then
    uber_note := E'\n\n(Simulated Uber Central adapter: in production the code would be placed in the trip instructions sent to the driver, subject to confirmed Uber Central API access.)';
  end if;

  perform private.notify('whatsapp', 'tourist', 'driver_assigned', 'Your driver has been assigned',
    format(E'YOUR DRIVER HAS BEEN ASSIGNED\n\nDriver: %s\nVehicle: %s %s\nColour: %s\nRegistration: %s\nProvider: %s\n\nPickup point: %s\nPickup time: %s\n\nVerification code: %s\n\nIMPORTANT: your driver must say this code FIRST. Never read it out yourself. If they can''t say it, do not get in. Tap "Something''s wrong".',
      d.full_name, v.make, v.model, v.colour, v.registration, p.name, pp.name, private.fmt_time(b.pickup_at), code),
    b.id, null, b.hotel_id, b.provider_id, null,
    jsonb_build_object('code', code, 'driver_id', d.id, 'vehicle_id', v.id));

  perform private.notify('whatsapp', 'driver', 'trip_assigned', 'New trip ' || b.reference,
    format(E'New trip %s\nGuest: %s (%s passenger(s), %s bag(s))\nPickup: %s at %s\nDestination: %s\n\nSay this code to the guest FIRST: %s\nDo not write it on a sign or show it on screen.%s',
      b.reference, split_part(t.full_name, ' ', 1), b.passengers, b.luggage, pp.name, private.fmt_time(b.pickup_at), b.destination, code, uber_note),
    b.id, null, null, b.provider_id, d.id, jsonb_build_object('code', code, 'guest', split_part(t.full_name, ' ', 1), 'passengers', b.passengers, 'luggage', b.luggage));

  perform private.notify('dashboard', 'hotel', 'driver_assigned', 'Driver assigned · ' || b.reference,
    format('%s · %s %s %s · %s', d.full_name, v.colour, v.make, v.model, v.registration), b.id, null, b.hotel_id);
  perform private.audit('assign_driver', 'booking', b.id, jsonb_build_object('driver', d.full_name, 'vehicle', v.registration));
  return exp;
end $$;

-- ================================================================ tourist (no login; token-based)

create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  h public.hotels; o public.hotel_transport_partners; pr public.transport_providers; tid uuid; b public.bookings;
  v_name text := trim(p ->> 'full_name');
  wa text := regexp_replace(coalesce(p ->> 'whatsapp', ''), '[\s()-]', '', 'g');
  pax int := coalesce((p ->> 'passengers')::int, 1);
  bags int := coalesce((p ->> 'luggage')::int, 0);
  v_at timestamptz := (p ->> 'pickup_at')::timestamptz;
  flight text := nullif(upper(regexp_replace(coalesce(p ->> 'flight_number', ''), '\s', '', 'g')), '');
  ttype text; st text; tok text;
begin
  if v_name is null or char_length(v_name) not between 2 and 60 then raise exception 'Please enter your name (2–60 characters)'; end if;
  if wa !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Please enter your WhatsApp number in international format, e.g. +44 7700 900123'; end if;
  if v_at is null or v_at < now() - interval '6 hours' or v_at > now() + interval '365 days' then raise exception 'Please choose a valid arrival date and time'; end if;
  if flight is not null and flight !~ '^[A-Z0-9]{2,8}$' then raise exception 'Flight number looks invalid'; end if;

  select * into h from public.hotels where (id::text = p ->> 'hotel_id' or slug = p ->> 'hotel_slug') and status = 'active';
  if h.id is null then raise exception 'Hotel not found or not an active partner'; end if;
  select * into o from public.hotel_transport_partners where id = (p ->> 'partner_id')::uuid and hotel_id = h.id and available;
  if o.id is null then raise exception 'That transport option is not available for this hotel'; end if;
  select * into pr from public.transport_providers where id = o.provider_id and status = 'active';
  if pr.id is null then raise exception 'That transport provider is not currently active'; end if;
  if pax > o.passenger_capacity then raise exception 'This option carries up to % passengers', o.passenger_capacity; end if;
  if bags > o.luggage_capacity then raise exception 'This option carries up to % bags', o.luggage_capacity; end if;
  if not exists (select 1 from public.pickup_points where id = p ->> 'pickup_point_id') then raise exception 'Unknown pickup location'; end if;

  insert into public.tourists (full_name, whatsapp, user_id, preferred_language)
  values (v_name, wa, case when app.role() = 'tourist' then auth.uid() end, coalesce(nullif(p ->> 'language', ''), 'en'))
  on conflict (whatsapp) do update set full_name = excluded.full_name, user_id = coalesce(public.tourists.user_id, excluded.user_id)
  returning id into tid;

  -- Rate limit: 5 booking requests per WhatsApp number per hour.
  if (select count(*) from public.bookings where tourist_id = tid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many booking requests — please wait a while or contact your hotel';
  end if;

  ttype := case pr.provider_type when 'hotel_fleet' then 'hotel' else pr.provider_type end;
  st := case when ttype = 'shuttle' and pr.owner_hotel_id is null then 'awaiting_provider' else 'pending' end;

  insert into public.bookings (reference, tourist_id, hotel_id, provider_id, partner_id, transport_type, pickup_point_id,
    destination, pickup_at, flight_number, passengers, luggage, vehicle_class, price_type, price_amount, price_min, price_max,
    payment_arrangement, status, source)
  values ('CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'),
    tid, h.id, pr.id, o.id, ttype, p ->> 'pickup_point_id',
    coalesce(nullif(trim(p ->> 'destination'), ''), h.name || coalesce(', ' || h.address, '')),
    v_at, flight, pax, bags, o.vehicle_class, o.price_type, o.price_amount, o.price_min, o.price_max,
    o.payment_arrangement, st, coalesce(nullif(p ->> 'source', ''), 'web'))
  returning * into b;
  insert into public.booking_tokens (booking_id) values (b.id) returning token into tok;

  perform private.notify('whatsapp', 'tourist', 'booking_received', 'Booking request received',
    format(E'Thanks %s! Your transport request %s has been received.\n\nFrom: %s\nTo: %s\nPickup: %s\nProvider: %s\nPrice: %s\nPayment: %s\n\nStatus: %s. We''ll message you when it''s confirmed and again when your driver is assigned.',
      split_part(v_name, ' ', 1), b.reference, (select name from public.pickup_points where id = b.pickup_point_id), b.destination,
      private.fmt_time(b.pickup_at), pr.name, private.price_text(b), b.payment_arrangement,
      case st when 'pending' then 'waiting for ' || h.name || ' to confirm' else 'waiting for ' || pr.name || ' to confirm' end),
    b.id);
  perform private.notify('dashboard', 'hotel', 'booking_request', 'New transport request · ' || b.reference,
    format('%s · %s pax · %s · %s', v_name, pax, private.fmt_time(b.pickup_at), pr.name), b.id, null, h.id);
  if st = 'awaiting_provider' then
    perform private.notify('dashboard', 'provider', 'booking_request', 'New booking request · ' || b.reference,
      format('%s guest · %s pax · %s bags · %s', h.name, pax, bags, private.fmt_time(b.pickup_at)), b.id, null, null, pr.id);
  end if;
  return jsonb_build_object('reference', b.reference, 'access_token', tok, 'status', b.status);
end $$;

-- Everything the tourist's booking page needs. Driver phone only once the driver is on the way.
create or replace function public.get_trip(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; bd public.booking_drivers;
begin
  b := private.booking_by_token(p_token);
  perform private.expire_codes(b.id);
  select * into bd from public.booking_drivers where booking_id = b.id and active;
  return jsonb_build_object(
    'booking', to_jsonb(b) - 'tourist_id',
    'tourist', (select jsonb_build_object('full_name', full_name, 'whatsapp', whatsapp) from public.tourists where id = b.tourist_id),
    'hotel', (select jsonb_build_object('name', name, 'slug', slug, 'area', area, 'address', address, 'phone', phone, 'email', email) from public.hotels where id = b.hotel_id),
    'provider', (select jsonb_build_object('name', name, 'provider_type', provider_type, 'integration', integration, 'contact_phone', contact_phone) from public.transport_providers where id = b.provider_id),
    'pickup_point', (select to_jsonb(pp) from public.pickup_points pp where id = b.pickup_point_id),
    'driver', case when bd.id is not null then (
      select jsonb_build_object('full_name', d.full_name, 'photo_path', d.photo_path,
        'phone', case when b.status in ('driver_on_way', 'driver_arrived') then d.phone end,
        'make', v.make, 'model', v.model, 'colour', v.colour, 'registration', v.registration, 'vehicle_class', v.vehicle_class)
      from public.drivers d, public.vehicles v where d.id = bd.driver_id and v.id = bd.vehicle_id) end,
    'code', (select n.payload ->> 'code' from public.notifications n
              where n.booking_id = b.id and n.recipient_type = 'tourist' and n.payload ? 'code' order by n.created_at desc limit 1),
    'code_expires_at', (select expires_at from public.verification_codes where booking_id = b.id and status = 'active'),
    'code_status', (select status from public.verification_codes where booking_id = b.id order by created_at desc limit 1),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'created_at', created_at) order by created_at)
                 from public.notifications where booking_id = b.id and recipient_type = 'tourist' and channel = 'whatsapp'), '[]'),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('outcome', outcome, 'created_at', created_at) order by created_at desc)
                 from public.verification_attempts where booking_id = b.id), '[]'),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('reference', reference, 'access_token', access_token, 'status', status, 'category', category, 'created_at', created_at) order by created_at desc)
                 from public.incidents where booking_id = b.id), '[]')
  );
end $$;

-- Signed-in tourists (Supabase Auth) can list their own trip links.
create or replace function public.my_trip_links() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('reference', b.reference, 'access_token', t.token, 'status', b.status,
    'pickup_at', b.pickup_at, 'hotel', h.name) order by b.pickup_at desc), '[]')
  from public.bookings b join public.booking_tokens t on t.booking_id = b.id
  join public.tourists tr on tr.id = b.tourist_id join public.hotels h on h.id = b.hotel_id
  where tr.user_id = auth.uid() and auth.uid() is not null
$$;

create or replace function public.record_verification(p_token text, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings;
begin
  b := private.booking_by_token(p_token);
  if p_outcome not in ('verified', 'code_mismatch', 'details_mismatch', 'wrong_vehicle', 'cannot_find') then raise exception 'Unknown outcome'; end if;
  if b.status not in ('driver_assigned', 'driver_on_way', 'driver_arrived') then
    raise exception 'Verification is only possible once a driver is assigned and before the ride starts';
  end if;
  if (select count(*) from public.verification_attempts where booking_id = b.id and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Too many attempts — please contact your hotel';
  end if;
  perform private.expire_codes(b.id);
  insert into public.verification_attempts (booking_id, outcome) values (b.id, p_outcome);

  if p_outcome = 'verified' then
    if not exists (select 1 from public.verification_codes where booking_id = b.id and status = 'active') then
      raise exception 'This verification code has expired or been cancelled — please contact your hotel before getting in';
    end if;
    perform private.end_code(b.id, 'used');
    update public.bookings set status = 'in_progress' where id = b.id;
    perform private.notify('whatsapp', 'tourist', 'verified', 'Driver verified',
      E'Driver verified ✅ Your ride has started. Enjoy Cape Town!\n\nIf anything feels wrong during the trip, tap "Something''s wrong" at any time.', b.id);
    perform private.notify('dashboard', 'hotel', 'verified', 'Guest verified driver · ' || b.reference, 'Ride in progress.', b.id, null, b.hotel_id);
  else
    perform private.notify('dashboard', 'hotel', 'verification_failed', 'Verification problem · ' || b.reference,
      'Guest reported: ' || replace(p_outcome, '_', ' ') || '. They have been told not to enter the vehicle.', b.id, null, b.hotel_id);
    perform private.notify('dashboard', 'provider', 'verification_failed', 'Verification problem · ' || b.reference,
      'Guest reported: ' || replace(p_outcome, '_', ' '), b.id, null, null, b.provider_id);
  end if;
  return jsonb_build_object('outcome', p_outcome);
end $$;

-- The tourist types what the driver SAID; compared against the hash. Doesn't consume the code.
create or replace function public.check_spoken_code(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; ok boolean;
begin
  b := private.booking_by_token(p_token);
  if (select count(*) from public.verification_attempts where booking_id = b.id and outcome like 'spoken%' and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many code checks — do not enter the vehicle; contact your hotel';
  end if;
  perform private.expire_codes(b.id);
  ok := exists (select 1 from public.verification_codes where booking_id = b.id and status = 'active' and code_hash = private.hash_code(p_code));
  insert into public.verification_attempts (booking_id, outcome) values (b.id, case when ok then 'spoken_code_match' else 'spoken_code_mismatch' end);
  return jsonb_build_object('match', ok);
end $$;

create or replace function public.cancel_my_booking(p_token text, p_reason text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings;
begin
  b := private.booking_by_token(p_token);
  if b.status in ('in_progress', 'completed', 'cancelled') then raise exception 'This booking can no longer be cancelled here'; end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = left(coalesce(nullif(p_reason, ''), 'Cancelled by guest'), 300) where id = b.id;
  update public.booking_drivers set active = false where booking_id = b.id and active;
  perform private.end_code(b.id, 'revoked');
  perform private.notify('whatsapp', 'tourist', 'cancelled', 'Booking cancelled', 'Your booking ' || b.reference || ' has been cancelled. Your verification code is no longer valid.', b.id);
  perform private.notify('dashboard', 'hotel', 'cancelled', 'Guest cancelled · ' || b.reference, coalesce(p_reason, 'No reason given'), b.id, null, b.hotel_id);
end $$;

create or replace function public.report_incident(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.bookings; i public.incidents; h uuid; pr uuid; ev jsonb;
  cat text := p ->> 'category';
  urgent boolean := coalesce((p ->> 'needs_immediate_help')::boolean, false);
begin
  if cat not in ('driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam', 'intimidation', 'cannot_locate_driver', 'other') then
    raise exception 'Please choose what went wrong';
  end if;
  if char_length(coalesce(p ->> 'description', '')) > 2000 then raise exception 'Description is too long (2000 characters max)'; end if;
  if jsonb_array_length(coalesce(p -> 'evidence', '[]')) > 3 then raise exception 'Up to 3 photos per report'; end if;

  if nullif(p ->> 'booking_token', '') is not null then
    b := private.booking_by_token(p ->> 'booking_token');
    if (select count(*) from public.incidents where booking_id = b.id and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'Several reports were already received for this booking in the last hour. If you are in danger call 10111 or 112.';
    end if;
    h := b.hotel_id; pr := b.provider_id;
  else
    h := (select id from public.hotels where slug = p ->> 'hotel_slug' and status = 'active');
  end if;

  insert into public.incidents (reference, booking_id, hotel_id, provider_id, tourist_id, category, description,
    pickup_point_id, location_text, needs_immediate_help, status)
  values ('SAFE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.incident_ref_seq')::text, 4, '0'),
    b.id, h, pr, b.tourist_id, cat, nullif(trim(p ->> 'description'), ''),
    coalesce(nullif(p ->> 'pickup_point_id', ''), b.pickup_point_id), left(nullif(trim(p ->> 'location_text'), ''), 200), urgent, 'received')
  returning * into i;

  for ev in select * from jsonb_array_elements(coalesce(p -> 'evidence', '[]')) loop
    insert into public.incident_evidence (incident_id, storage_path, content_type) values (i.id, ev ->> 'path', ev ->> 'content_type');
  end loop;

  insert into public.incident_updates (incident_id, status, message) values
    (i.id, 'received', 'Your report has been received and logged with reference ' || i.reference || '.');

  if pr is not null and cat in ('driver_mismatch', 'code_incorrect', 'vehicle_mismatch', 'extra_payment', 'suspected_scam', 'intimidation', 'cannot_locate_driver') then
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
  update public.incidents set status = case when h is not null then 'hotel_pending' when pr is not null then 'provider_notified' else 'received' end
   where id = i.id returning * into i;

  perform private.notify('dashboard', 'admin', 'incident', 'New incident ' || i.reference, replace(cat, '_', ' '), b.id, i.id);
  if b.id is not null then
    perform private.notify('whatsapp', 'tourist', 'incident_received', 'Report received',
      format(E'Your report has been received.\n\nReference: %s\n\n%sWe will keep you updated as your report progresses.%s',
        i.reference, case when h is not null then 'Your hotel has been notified. ' else '' end,
        case when urgent then E'\n\nIf you are in immediate danger call 10111 (police) or 112 from a mobile.' else '' end),
      b.id, i.id);
  end if;
  return jsonb_build_object('reference', i.reference, 'access_token', i.access_token, 'status', i.status);
end $$;

create or replace function public.get_incident(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare i public.incidents;
begin
  select * into i from public.incidents where access_token = p_token;
  if i.id is null or length(p_token) < 20 then raise exception 'Report not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'incident', jsonb_build_object('reference', i.reference, 'category', i.category, 'status', i.status, 'created_at', i.created_at,
      'updated_at', i.updated_at, 'description', i.description, 'location_text', i.location_text,
      'needs_immediate_help', i.needs_immediate_help, 'police_case_number', i.police_case_number),
    'booking_reference', (select reference from public.bookings where id = i.booking_id),
    'hotel', (select jsonb_build_object('name', name, 'phone', phone) from public.hotels where id = i.hotel_id),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'message', message, 'created_at', created_at) order by created_at)
                from public.incident_updates where incident_id = i.id and visibility = 'public'), '[]'));
end $$;

-- ================================================================ hotel / provider / driver

create or replace function public.confirm_booking(p_booking uuid, p_price numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; r text; pr public.transport_providers;
begin
  select * into b from public.bookings where id = p_booking for update;
  r := private.require_booking_staff(b);
  if b.status not in ('pending', 'awaiting_provider') then raise exception 'Only pending bookings can be confirmed'; end if;
  if p_price is not null and (p_price <= 0 or p_price > 20000) then raise exception 'Price must be between R1 and R20 000'; end if;
  if b.price_type = 'on_request' and p_price is null then raise exception 'Set an agreed price before confirming this booking'; end if;
  select * into pr from public.transport_providers where id = b.provider_id;

  update public.bookings set
    status = 'confirmed', status_note = left(p_note, 300),
    price_type = case when p_price is not null then 'agreed' else price_type end,
    price_amount = coalesce(p_price, price_amount),
    price_confirmed = (p_price is not null or price_type = 'agreed'),
    external_ref = case when pr.integration = 'uber_central' then 'SIM-UBER-' || upper(encode(gen_random_bytes(3), 'hex')) else external_ref end,
    external_simulated = (pr.integration = 'uber_central')
  where id = b.id returning * into b;

  perform private.notify('whatsapp', 'tourist', 'confirmed', 'Booking confirmed',
    format(E'Your booking %s is confirmed ✅\n\nProvider: %s\nPickup: %s\nPrice: %s\nPayment: %s%s\n\nWe''ll send your driver''s details and a verification code once a driver is assigned.',
      b.reference, pr.name, private.fmt_time(b.pickup_at), private.price_text(b), b.payment_arrangement,
      case when pr.integration = 'uber_central' then E'\n\nNote: Uber Central is simulated in this demo — no real Uber trip has been requested.' else '' end),
    b.id);
  if r = 'provider_staff' then
    perform private.notify('dashboard', 'hotel', 'provider_confirmed', pr.name || ' confirmed ' || b.reference, 'Ready for driver assignment.', b.id, null, b.hotel_id);
  elsif pr.owner_hotel_id is null and pr.provider_type = 'shuttle' then
    perform private.notify('dashboard', 'provider', 'hotel_confirmed', 'Hotel confirmed ' || b.reference, 'Please assign a driver.', b.id, null, null, b.provider_id);
  end if;
  perform private.audit('confirm_booking', 'booking', b.id, jsonb_build_object('price', p_price));
end $$;

create or replace function public.decline_booking(p_booking uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; r text;
begin
  select * into b from public.bookings where id = p_booking for update;
  r := private.require_booking_staff(b);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason'; end if;
  if b.status not in ('pending', 'awaiting_provider', 'confirmed') then raise exception 'This booking can''t be declined at its current stage'; end if;
  if r = 'provider_staff' then
    -- Provider declines: the hotel must arrange an alternative; the guest isn't cancelled.
    update public.bookings set status = 'pending', status_note = 'Declined by provider: ' || left(p_reason, 250) where id = b.id;
    perform private.notify('dashboard', 'hotel', 'provider_declined', 'Provider declined ' || b.reference, p_reason, b.id, null, b.hotel_id);
  else
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 300) where id = b.id;
    perform private.end_code(b.id, 'revoked');
    perform private.notify('whatsapp', 'tourist', 'declined', 'Booking not confirmed',
      format(E'Sorry, %s couldn''t confirm booking %s: %s\n\nPlease contact the hotel directly to arrange transport. Never accept a lift from someone who approaches you at the airport.',
        (select name from public.hotels where id = b.hotel_id), b.reference, p_reason), b.id);
  end if;
  perform private.audit('decline_booking', 'booking', b.id, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.change_booking_option(p_booking uuid, p_partner uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; o public.hotel_transport_partners; pr public.transport_providers;
begin
  select * into b from public.bookings where id = p_booking for update;
  if app.role() not in ('admin', 'hotel_staff') then raise exception 'Only the hotel can change the transport option' using errcode = '42501'; end if;
  perform private.require_booking_staff(b);
  if b.status not in ('pending', 'awaiting_provider', 'confirmed') then raise exception 'Unassign or cancel the driver before changing provider'; end if;
  select * into o from public.hotel_transport_partners where id = p_partner and hotel_id = b.hotel_id;
  select * into pr from public.transport_providers where id = o.provider_id and status = 'active';
  if o.id is null or pr.id is null then raise exception 'Option not available for this hotel'; end if;
  if b.passengers > o.passenger_capacity then raise exception 'That option carries up to % passengers', o.passenger_capacity; end if;
  update public.bookings set provider_id = pr.id, partner_id = o.id,
    transport_type = case pr.provider_type when 'hotel_fleet' then 'hotel' else pr.provider_type end,
    vehicle_class = o.vehicle_class, price_type = o.price_type, price_amount = o.price_amount, price_min = o.price_min,
    price_max = o.price_max, price_confirmed = false, payment_arrangement = o.payment_arrangement, external_ref = null, external_simulated = false,
    status = case when pr.provider_type = 'shuttle' and pr.owner_hotel_id is null then 'awaiting_provider' else 'pending' end,
    status_note = 'Transport option changed to ' || pr.name
  where id = b.id returning * into b;
  if b.status = 'awaiting_provider' then
    perform private.notify('dashboard', 'provider', 'booking_request', 'New booking request · ' || b.reference, 'Assigned by hotel', b.id, null, null, pr.id);
  end if;
  perform private.notify('whatsapp', 'tourist', 'option_changed', 'Transport updated',
    format(E'Your hotel updated booking %s.\n\nProvider: %s (%s)\nPrice: %s\nPayment: %s', b.reference, pr.name, o.vehicle_class, private.price_text(b), b.payment_arrangement), b.id);
  perform private.audit('change_option', 'booking', b.id, jsonb_build_object('provider', pr.name));
end $$;

create or replace function public.set_booking_price(p_booking uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  perform private.require_booking_staff(b);
  if p_amount is null or p_amount <= 0 or p_amount > 20000 then raise exception 'Price must be between R1 and R20 000'; end if;
  if b.status in ('in_progress', 'completed', 'cancelled') then raise exception 'The price can''t be changed after pickup'; end if;
  update public.bookings set price_type = 'agreed', price_amount = p_amount, price_confirmed = true where id = b.id returning * into b;
  perform private.notify('whatsapp', 'tourist', 'price_set', 'Price confirmed',
    format(E'The price for %s is now confirmed: %s.\n\nPayment: %s\nYou should not be asked to pay anything extra at pickup.', b.reference, private.price_text(b), b.payment_arrangement), b.id);
  perform private.audit('set_price', 'booking', b.id, jsonb_build_object('amount', p_amount));
end $$;

create or replace function public.assign_driver(p_booking uuid, p_driver uuid, p_vehicle uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; exp timestamptz;
begin
  select * into b from public.bookings where id = p_booking for update;
  perform private.require_booking_staff(b);
  exp := private.do_assign(b, p_driver, p_vehicle);
  -- The code itself is never returned to staff dashboards.
  return jsonb_build_object('code_expires_at', exp, 'delivered_to', jsonb_build_array('tourist WhatsApp', 'driver WhatsApp'));
end $$;

create or replace function public.update_trip_status(p_booking uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; r text; d public.drivers; pp public.pickup_points; ok boolean;
begin
  select * into b from public.bookings where id = p_booking for update;
  r := private.require_booking_staff(b, true);
  ok := (b.status, p_status) in (('driver_assigned', 'driver_on_way'), ('driver_on_way', 'driver_arrived'), ('in_progress', 'completed'))
     or (p_status = 'in_progress' and b.status in ('driver_assigned', 'driver_on_way', 'driver_arrived') and r <> 'driver');
  if not ok then
    raise exception '% → % is not allowed%', b.status, p_status,
      case when p_status = 'in_progress' and r = 'driver' then ': the guest must verify you first' else '' end;
  end if;
  if p_status = 'in_progress' and char_length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'Starting a ride without guest verification needs a reason';
  end if;

  update public.bookings set status = p_status, status_note = left(p_note, 300),
    completed_at = case when p_status = 'completed' then now() end where id = b.id returning * into b;
  select d2.* into d from public.drivers d2 join public.booking_drivers bd on bd.driver_id = d2.id and bd.active where bd.booking_id = b.id;
  select * into pp from public.pickup_points where id = b.pickup_point_id;

  if p_status = 'driver_on_way' then
    perform private.notify('whatsapp', 'tourist', 'driver_on_way', 'Driver on the way',
      format(E'%s is on the way to %s.\n\nMeet at: %s\n\nRemember: the driver says your code first.', d.full_name, pp.name, pp.description), b.id);
  elsif p_status = 'driver_arrived' then
    perform private.notify('whatsapp', 'tourist', 'driver_arrived', 'Driver has arrived',
      format(E'%s has arrived at %s.\n\nCheck the registration and vehicle, and ask the driver to say your verification code FIRST. If anything doesn''t match, do not get in.', d.full_name, pp.name), b.id);
  elsif p_status = 'in_progress' then
    perform private.end_code(b.id, 'used');
    perform private.audit('start_without_verification', 'booking', b.id, jsonb_build_object('reason', p_note));
  elsif p_status = 'completed' then
    perform private.end_code(b.id, 'used');
    perform private.notify('whatsapp', 'tourist', 'completed', 'Trip completed',
      'You''ve arrived. Welcome to Cape Town! 🌍 If anything went wrong on this trip you can still report it from your booking link.', b.id);
  end if;
  perform private.notify('dashboard', 'hotel', 'trip_' || p_status, initcap(replace(p_status, '_', ' ')) || ' · ' || b.reference,
    coalesce(p_note, ''), b.id, null, b.hotel_id);
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.bookings; drv uuid;
begin
  select * into b from public.bookings where id = p_booking for update;
  perform private.require_booking_staff(b);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason'; end if;
  if b.status in ('completed', 'cancelled') then raise exception 'Booking is already %', b.status; end if;
  select driver_id into drv from public.booking_drivers where booking_id = b.id and active;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 300) where id = b.id;
  update public.booking_drivers set active = false where booking_id = b.id and active;
  perform private.end_code(b.id, 'revoked');
  perform private.notify('whatsapp', 'tourist', 'cancelled', 'Booking cancelled',
    format(E'Booking %s has been cancelled: %s\n\nYour verification code is no longer valid. Do not get into any vehicle claiming to be this booking.', b.reference, p_reason), b.id);
  if drv is not null then
    perform private.notify('whatsapp', 'driver', 'trip_cancelled', 'Trip cancelled', 'Trip ' || b.reference || ' was cancelled.', b.id, null, null, b.provider_id, drv);
  end if;
  perform private.audit('cancel_booking', 'booking', b.id, jsonb_build_object('reason', p_reason));
end $$;

-- ================================================================ incidents (staff)

create or replace function public.update_incident(p_incident uuid, p_status text, p_message text, p_public boolean default true) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i public.incidents; r text;
begin
  select * into i from public.incidents where id = p_incident for update;
  r := private.require_incident_staff(i);
  if p_status is not null and p_status not in ('received', 'hotel_notified', 'hotel_pending', 'provider_notified', 'escalated',
     'referred_authorities', 'follow_up', 'resolved', 'closed') then raise exception 'Unknown status'; end if;
  if char_length(trim(coalesce(p_message, ''))) < 3 then raise exception 'Add a short message explaining the update'; end if;
  if p_status = 'closed' and r <> 'admin' then raise exception 'Only the safety team can close a report — mark it resolved instead'; end if;

  if p_status is not null then
    update public.incidents set status = p_status,
      closed_at = case when p_status in ('resolved', 'closed') then now() end where id = i.id;
  end if;
  insert into public.incident_updates (incident_id, status, message, visibility, author_id, author_label)
  values (i.id, p_status, left(trim(p_message), 2000), case when p_public then 'public' else 'internal' end, auth.uid(), private.actor_label());

  if p_status in ('provider_notified', 'escalated') and i.provider_id is not null then
    perform private.notify('dashboard', 'provider', 'incident', case p_status when 'escalated' then 'Escalated to your safety team · ' else 'Incident · ' end || i.reference,
      p_message, i.booking_id, i.id, null, i.provider_id);
  end if;
  if r <> 'hotel_staff' and i.hotel_id is not null then
    perform private.notify('dashboard', 'hotel', 'incident_update', 'Update on ' || i.reference, p_message, i.booking_id, i.id, i.hotel_id);
  end if;
  if p_public and i.booking_id is not null then
    perform private.notify('whatsapp', 'tourist', 'incident_update', 'Update on your report',
      format(E'Update on your report %s:\n\n%s', i.reference, trim(p_message)), i.booking_id, i.id);
  end if;
  perform private.audit('update_incident', 'incident', i.id, jsonb_build_object('status', p_status, 'public', p_public));
end $$;

create or replace function public.assign_incident_handler(p_incident uuid, p_handler uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  if p_handler is not null and not exists (select 1 from public.profiles where id = p_handler and role = 'admin') then
    raise exception 'Handlers must be safety-team (admin) users';
  end if;
  update public.incidents set handler_id = p_handler where id = p_incident;
  insert into public.incident_updates (incident_id, message, visibility, author_id, author_label)
  values (p_incident, 'Handler set to ' || coalesce((select full_name from public.profiles where id = p_handler), 'nobody'), 'internal', auth.uid(), private.actor_label());
  perform private.audit('assign_handler', 'incident', p_incident, jsonb_build_object('handler', p_handler));
end $$;

-- Records an OFFICIAL police case number supplied by the tourist. The platform never issues one.
create or replace function public.set_police_reference(p_incident uuid, p_case text, p_station text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i public.incidents;
begin
  select * into i from public.incidents where id = p_incident;
  perform private.require_incident_staff(i);
  if app.role() = 'provider_staff' then raise exception 'Only the hotel or safety team can record police references' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_case, ''))) not between 3 and 40 then raise exception 'Enter the case number exactly as given by SAPS'; end if;
  update public.incidents set police_case_number = trim(p_case), police_station = nullif(trim(p_station), '') where id = i.id;
  insert into public.incident_updates (incident_id, message, visibility, author_id, author_label) values
    (i.id, 'External police case reference recorded: ' || trim(p_case) || coalesce(' (' || nullif(trim(p_station), '') || ')', '') || '. Supplied by the tourist; not issued by this platform.', 'internal', auth.uid(), private.actor_label()),
    (i.id, 'The police case number you provided has been added to your report.', 'public', auth.uid(), private.actor_label());
  perform private.audit('set_police_reference', 'incident', i.id, jsonb_build_object('case', p_case));
end $$;

-- ================================================================ partner management

create or replace function public.set_partner_status(p_kind text, p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.require_admin();
  if p_kind = 'hotel' and p_status in ('pending', 'active', 'suspended') then
    update public.hotels set status = p_status where id = p_id;
  elsif p_kind = 'provider' and p_status in ('pending', 'active', 'suspended') then
    update public.transport_providers set status = p_status where id = p_id;
  elsif p_kind = 'driver' and p_status in ('pending', 'approved', 'rejected', 'suspended') then
    update public.drivers set status = p_status, review_note = left(p_note, 300),
      approved_at = case when p_status = 'approved' then now() end where id = p_id;
  else
    raise exception 'Invalid % status: %', p_kind, p_status;
  end if;
  if not found then raise exception '% not found', p_kind; end if;
  perform private.audit('set_status', p_kind, p_id, jsonb_build_object('status', p_status, 'note', p_note));
end $$;

create or replace function public.register_hotel(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare id uuid;
begin
  perform private.require_admin();
  insert into public.hotels (slug, name, area, address, phone, email, short_code, status, default_pickup_point_id)
  values (lower(p ->> 'slug'), p ->> 'name', p ->> 'area', p ->> 'address', p ->> 'phone', p ->> 'email',
    lower(p ->> 'short_code'), 'pending', coalesce(nullif(p ->> 'default_pickup_point_id', ''), 'cpt-intl'))
  returning hotels.id into id;
  perform private.audit('register', 'hotel', id, p);
  return id;
end $$;

create or replace function public.register_provider(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare id uuid;
begin
  perform private.require_admin();
  insert into public.transport_providers (name, provider_type, contact_phone, contact_email, safety_contact, status)
  values (p ->> 'name', p ->> 'provider_type', p ->> 'contact_phone', p ->> 'contact_email', p ->> 'safety_contact', 'pending')
  returning transport_providers.id into id;
  perform private.audit('register', 'provider', id, p);
  return id;
end $$;

create or replace function private.require_provider_manager(p_provider uuid) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if app.is_admin() or p_provider = app.my_provider()
     or exists (select 1 from public.transport_providers where id = p_provider and owner_hotel_id = app.my_hotel()) then return; end if;
  raise exception 'Not authorised for this provider' using errcode = '42501';
end $$;

-- New drivers always start as pending until the safety team approves them.
create or replace function public.add_driver(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare id uuid; pid uuid := coalesce((p ->> 'provider_id')::uuid, app.my_provider());
begin
  perform private.require_provider_manager(pid);
  if coalesce(p ->> 'phone', '') !~ '^\+?[0-9 ]{9,16}$' then raise exception 'Enter a valid phone number'; end if;
  insert into public.drivers (provider_id, full_name, phone, photo_path, status)
  values (pid, trim(p ->> 'full_name'), p ->> 'phone', nullif(p ->> 'photo_path', ''), 'pending') returning drivers.id into id;
  perform private.notify('dashboard', 'admin', 'driver_review', 'Driver awaiting review', trim(p ->> 'full_name'), null, null, null, pid);
  perform private.audit('add_driver', 'driver', id, p - 'phone');
  return id;
end $$;

create or replace function public.add_vehicle(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare id uuid; pid uuid := coalesce((p ->> 'provider_id')::uuid, app.my_provider());
begin
  perform private.require_provider_manager(pid);
  insert into public.vehicles (provider_id, make, model, colour, registration, vehicle_class, seats, luggage)
  values (pid, p ->> 'make', p ->> 'model', p ->> 'colour', upper(trim(p ->> 'registration')), p ->> 'vehicle_class',
    (p ->> 'seats')::int, (p ->> 'luggage')::int) returning vehicles.id into id;
  perform private.audit('add_vehicle', 'vehicle', id, p);
  return id;
end $$;

create or replace function public.save_partner_option(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare id uuid; hid uuid := coalesce((p ->> 'hotel_id')::uuid, app.my_hotel());
begin
  if not (app.is_admin() or hid = app.my_hotel()) then raise exception 'Not authorised' using errcode = '42501'; end if;
  insert into public.hotel_transport_partners (hotel_id, provider_id, vehicle_class, passenger_capacity, luggage_capacity,
    price_type, price_amount, price_min, price_max, payment_arrangement, available)
  values (hid, (p ->> 'provider_id')::uuid, p ->> 'vehicle_class', (p ->> 'passenger_capacity')::int, (p ->> 'luggage_capacity')::int,
    p ->> 'price_type', (p ->> 'price_amount')::numeric, (p ->> 'price_min')::numeric, (p ->> 'price_max')::numeric,
    p ->> 'payment_arrangement', coalesce((p ->> 'available')::boolean, true))
  on conflict (hotel_id, provider_id, vehicle_class) do update set
    passenger_capacity = excluded.passenger_capacity, luggage_capacity = excluded.luggage_capacity,
    price_type = excluded.price_type, price_amount = excluded.price_amount, price_min = excluded.price_min,
    price_max = excluded.price_max, payment_arrangement = excluded.payment_arrangement, available = excluded.available
  returning hotel_transport_partners.id into id;
  perform private.audit('save_option', 'hotel', hid, p);
  return id;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = public, extensions as $$
  update public.notifications set read_at = now()
   where id = any(p_ids) and read_at is null and (
     (recipient_type = 'hotel' and hotel_id = app.my_hotel())
     or (recipient_type = 'provider' and provider_id = app.my_provider())
     or (recipient_type = 'driver' and driver_id = app.my_driver())
     or (recipient_type = 'admin' and app.is_admin()))
$$;

-- Lock down: private helpers are not callable by clients.
revoke execute on all functions in schema private from public, anon, authenticated;
