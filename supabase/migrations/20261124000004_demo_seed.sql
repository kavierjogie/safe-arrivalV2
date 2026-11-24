-- 4/4  Demo data as a function, so Reset Demo can restore it.
-- All names, phone numbers and businesses are FICTIONAL. Tourist numbers use
-- ranges reserved for fiction (UK +44 7700 900xxx, US +1 202 555 01xx).
-- Dates are relative to now() so the demo always looks current.

create or replace function private.seed_demo_data() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  -- fixed ids (the frontend's demo-account list refers to the profile ids)
  h1 uuid := 'a0000000-0000-4000-8000-000000000001'; h2 uuid := 'a0000000-0000-4000-8000-000000000002';
  h3 uuid := 'a0000000-0000-4000-8000-000000000003'; h4 uuid := 'a0000000-0000-4000-8000-000000000004';
  p1 uuid := 'b0000000-0000-4000-8000-000000000001'; p2 uuid := 'b0000000-0000-4000-8000-000000000002';
  p3 uuid := 'b0000000-0000-4000-8000-000000000003'; p4 uuid := 'b0000000-0000-4000-8000-000000000004';
  p5 uuid := 'b0000000-0000-4000-8000-000000000005'; p6 uuid := 'b0000000-0000-4000-8000-000000000006';
  d1 uuid := 'c0000000-0000-4000-8000-000000000001'; d2 uuid := 'c0000000-0000-4000-8000-000000000002';
  d3 uuid := 'c0000000-0000-4000-8000-000000000003'; d4 uuid := 'c0000000-0000-4000-8000-000000000004';
  d5 uuid := 'c0000000-0000-4000-8000-000000000005'; d6 uuid := 'c0000000-0000-4000-8000-000000000006';
  d7 uuid := 'c0000000-0000-4000-8000-000000000007'; d8 uuid := 'c0000000-0000-4000-8000-000000000008';
  v1 uuid := 'd0000000-0000-4000-8000-000000000001'; v2 uuid := 'd0000000-0000-4000-8000-000000000002';
  v3 uuid := 'd0000000-0000-4000-8000-000000000003'; v4 uuid := 'd0000000-0000-4000-8000-000000000004';
  v5 uuid := 'd0000000-0000-4000-8000-000000000005'; v6 uuid := 'd0000000-0000-4000-8000-000000000006';
  v7 uuid := 'd0000000-0000-4000-8000-000000000007';
  o uuid[]; t uuid[]; bk public.bookings; inc uuid; i int; n int;
  hist_hotel uuid[]; hist_opt int[]; pts text[] := array['cpt-intl', 'cpt-intl', 'cpt-dom', 'cpt-intl', 'va-waterfront', 'cpt-intl', 'cpt-station'];
  cats text[]; st text; ts timestamptz;
begin
  insert into public.app_settings (key, value) values
    ('code_ttl_minutes', '180'), ('demo_mode', 'true')
  on conflict (key) do update set value = excluded.value;

  insert into public.pickup_points (id, name, kind, description, terminal_info, lat, lng) values
    ('cpt-intl', 'Cape Town International Airport · International Arrivals', 'airport',
     'Designated transport pickup area outside International Arrivals. Walk out of the arrivals hall and follow the signs for transport and shuttles. Your driver meets you there — never go with someone who approaches you inside the terminal.',
     'International Arrivals hall, ground level', -33.9697, 18.5968),
    ('cpt-dom', 'Cape Town International Airport · Domestic Arrivals', 'airport',
     'Designated transport pickup area outside Domestic Arrivals. Follow the transport and shuttle signs from the arrivals hall.',
     'Domestic Arrivals hall, ground level', -33.9709, 18.6012),
    ('va-waterfront', 'V&A Waterfront · Main shuttle & taxi rank', 'other',
     'Official shuttle and taxi rank near the main Waterfront entrance. Wait inside the marked rank area.', null, -33.9050, 18.4190),
    ('cpt-station', 'Cape Town Station · Adderley Street entrance', 'station',
     'Main entrance on Adderley Street. Wait near the information desk inside until your driver confirms arrival.', null, -33.9222, 18.4253)
  on conflict (id) do nothing;

  insert into public.hotels (id, slug, name, area, address, phone, email, short_code, status, default_pickup_point_id) values
    (h1, 'hotel-001', 'Saltwater Lodge', 'Sea Point', '12 Beach Road, Sea Point', '+27 21 000 0101', 'frontdesk@saltwaterlodge.demo', 'swl', 'active', 'cpt-intl'),
    (h2, 'hotel-002', 'Quayside Grand Hotel', 'V&A Waterfront', '3 Dock Road, V&A Waterfront', '+27 21 000 0202', 'concierge@quaysidegrand.demo', 'qgh', 'active', 'cpt-intl'),
    (h3, 'hotel-003', 'Bo-Kaap Lantern Guesthouse', 'Bo-Kaap', '45 Wale Street, Bo-Kaap', '+27 21 000 0303', 'stay@lanternguesthouse.demo', 'bkl', 'active', 'cpt-intl'),
    (h4, 'hotel-004', 'Vineyard Hill Hotel', 'Constantia', '8 Spaanschemat River Road, Constantia', '+27 21 000 0404', 'hello@vineyardhill.demo', 'vhh', 'pending', 'cpt-intl');

  insert into public.transport_providers (id, name, provider_type, integration, owner_hotel_id, status, contact_phone, contact_email, safety_contact) values
    (p1, 'Saltwater Lodge Transfers', 'hotel_fleet', 'manual', h1, 'active', '+27 21 000 0111', 'transfers@saltwaterlodge.demo', 'Duty manager · +27 21 000 0101'),
    (p2, 'Cape Town Trusted Shuttle', 'shuttle', 'manual', null, 'active', '+27 21 000 0222', 'dispatch@trustedshuttle.demo', 'Safety desk · +27 21 000 0223'),
    (p3, 'Peninsula Airport Shuttles', 'shuttle', 'manual', null, 'active', '+27 21 000 0333', 'ops@peninsulashuttles.demo', 'Operations · +27 21 000 0334'),
    (p4, 'Uber Central (simulated)', 'ehailing', 'uber_central', null, 'active', null, null, 'Uber safety line (in production)'),
    (p5, 'Table Bay Executive Cars', 'shuttle', 'manual', null, 'pending', '+27 21 000 0555', 'bookings@tablebaycars.demo', null),
    (p6, 'Quayside Grand Chauffeurs', 'hotel_fleet', 'manual', h2, 'active', '+27 21 000 0666', 'chauffeur@quaysidegrand.demo', 'Concierge · +27 21 000 0202');

  insert into public.provider_service_areas (provider_id, area) values
    (p1, 'Atlantic Seaboard'), (p2, 'City Bowl'), (p2, 'Atlantic Seaboard'), (p2, 'V&A Waterfront'), (p2, 'Southern Suburbs'),
    (p3, 'City Bowl'), (p3, 'Bo-Kaap'), (p3, 'V&A Waterfront'), (p4, 'Greater Cape Town'), (p5, 'Southern Suburbs'), (p6, 'V&A Waterfront');

  insert into public.drivers (id, provider_id, full_name, phone, status, approved_at) values
    (d1, p1, 'Michael Daniels', '+27 82 000 0101', 'approved', now() - interval '90 days'),
    (d2, p2, 'Thandi Nkosi', '+27 82 000 0202', 'approved', now() - interval '120 days'),
    (d3, p2, 'Sipho Mahlangu', '+27 82 000 0203', 'approved', now() - interval '60 days'),
    (d4, p3, 'Ayesha Petersen', '+27 82 000 0301', 'approved', now() - interval '75 days'),
    (d5, p4, 'Johan van Wyk', '+27 82 000 0401', 'approved', now() - interval '30 days'),
    (d6, p3, 'Lerato Mokoena', '+27 82 000 0302', 'pending', null),
    (d7, p6, 'Pieter Botha', '+27 82 000 0601', 'approved', now() - interval '200 days'),
    (d8, p2, 'Kagiso Molefe', '+27 82 000 0204', 'suspended', null);
  update public.drivers set review_note = 'Suspended pending review of a guest complaint (demo).' where id = d8;

  insert into public.vehicles (id, provider_id, make, model, colour, registration, vehicle_class, seats, luggage) values
    (v1, p1, 'Toyota', 'Corolla', 'White', 'CA 123-456', 'Sedan', 4, 3),
    (v7, p1, 'Toyota', 'Fortuner', 'Grey', 'CA 218-664', 'SUV', 6, 5),
    (v2, p2, 'Toyota', 'Quantum', 'Silver', 'CA 456-789', 'Minibus', 13, 10),
    (v3, p2, 'Volkswagen', 'Caravelle', 'Grey', 'CA 902-311', 'Minibus', 7, 7),
    (v4, p3, 'Hyundai', 'H1', 'White', 'CY 334-210', 'Minibus', 8, 8),
    (v5, p4, 'Suzuki', 'Dzire', 'Blue', 'CA 771-045', 'Sedan', 4, 2),
    (v6, p6, 'Mercedes-Benz', 'E-Class', 'Black', 'CA 550-008', 'Executive sedan', 3, 3);

  with ins as (
    insert into public.hotel_transport_partners (hotel_id, provider_id, vehicle_class, passenger_capacity, luggage_capacity, price_type, price_amount, price_min, price_max, payment_arrangement)
    values
      (h1, p1, 'Sedan', 3, 3, 'agreed', 450, null, null, 'Charged to your room by Saltwater Lodge — nothing to pay the driver'),
      (h1, p2, 'Minibus', 10, 10, 'agreed', 620, null, null, 'Charged to your room by Saltwater Lodge — nothing to pay the driver'),
      (h1, p4, 'Sedan (UberX)', 4, 2, 'estimate', null, 280, 380, 'Billed to the hotel''s Uber Central account, then added to your room bill'),
      (h2, p6, 'Executive sedan', 3, 3, 'agreed', 550, null, null, 'Included in your Quayside Grand reservation'),
      (h2, p2, 'Minibus', 10, 10, 'agreed', 600, null, null, 'Charged to your room by Quayside Grand Hotel'),
      (h2, p3, 'Minibus', 8, 8, 'on_request', null, null, null, 'Paid to Peninsula Airport Shuttles through their booking link — price confirmed before pickup'),
      (h2, p4, 'Sedan (UberX)', 4, 2, 'estimate', null, 260, 360, 'Billed to the hotel''s Uber Central account, then added to your room bill'),
      (h3, p3, 'Minibus', 7, 7, 'agreed', 480, null, null, 'Paid to Peninsula Airport Shuttles in advance by secure card link — nothing to pay the driver'),
      (h3, p4, 'Sedan (UberX)', 4, 2, 'estimate', null, 250, 340, 'Billed to the guesthouse''s Uber Central account')
    returning id
  ) select array_agg(id) into o from ins;
  -- o[]: 1 h1-p1, 2 h1-p2, 3 h1-p4, 4 h2-p6, 5 h2-p2, 6 h2-p3, 7 h2-p4, 8 h3-p3, 9 h3-p4  (insert order is preserved)

  -- Staff profiles for demo users that exist in auth.users.
  insert into public.profiles (id, full_name, email, role, hotel_id, provider_id, driver_id)
  select u.id, x.full_name, u.email, x.role, x.hotel_id, x.provider_id, x.driver_id
  from (values
    ('f0000000-0000-4000-8000-000000000001'::uuid, 'Nomsa Dlamini', 'admin', null::uuid, null::uuid, null::uuid),
    ('f0000000-0000-4000-8000-000000000002', 'Fatima Isaacs', 'hotel_staff', h1, null, null),
    ('f0000000-0000-4000-8000-000000000003', 'Ryan Adams', 'hotel_staff', h2, null, null),
    ('f0000000-0000-4000-8000-000000000004', 'Bongani Zulu', 'provider_staff', null, p2, null),
    ('f0000000-0000-4000-8000-000000000005', 'Michael Daniels', 'driver', null, null, d1),
    ('f0000000-0000-4000-8000-000000000006', 'Chantal Jacobs', 'provider_staff', null, p3, null),
    ('f0000000-0000-4000-8000-000000000007', 'Thandi Nkosi', 'driver', null, null, d2),
    ('f0000000-0000-4000-8000-000000000008', 'Lwazi Ndlovu', 'admin', null, null, null)
  ) as x(id, full_name, role, hotel_id, provider_id, driver_id)
  join auth.users u on u.id = x.id
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role,
    hotel_id = excluded.hotel_id, provider_id = excluded.provider_id, driver_id = excluded.driver_id;

  with ins as (
    insert into public.tourists (full_name, whatsapp) values
      ('Emma Clarke', '+447700900201'), ('James Okafor', '+447700900202'), ('Lena Fischer', '+447700900203'),
      ('Marco Rossi', '+447700900204'), ('Aiko Tanaka', '+12025550143'), ('Daniel Brooks', '+12025550144'),
      ('Sophie Martin', '+447700900205'), ('Wei Chen', '+12025550145'), ('Olivia Grant', '+447700900206'),
      ('Pedro Alvarez', '+12025550146')
    returning id
  ) select array_agg(id) into t from ins;

  -- ---- Historical journeys (past 8 weeks) for the dashboards and analytics.
  hist_hotel := array[h1, h1, h2, h2, h3, h2, h1, h3, h2, h1];
  hist_opt   := array[1, 3, 4, 5, 8, 7, 2, 9, 6, 1];
  for i in 1..28 loop
    n := 1 + (i % 10);
    ts := date_trunc('hour', now()) - make_interval(days => 2 + (i * 2) % 56, hours => (i * 5) % 14);
    insert into public.bookings (reference, tourist_id, hotel_id, provider_id, partner_id, transport_type, pickup_point_id, destination,
      pickup_at, passengers, luggage, vehicle_class, price_type, price_amount, price_min, price_max, price_confirmed, payment_arrangement,
      status, source, created_at, completed_at, cancelled_at, cancel_reason)
    select 'CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'),
      t[n], x.hotel_id, x.provider_id, x.id, case pr.provider_type when 'hotel_fleet' then 'hotel' else pr.provider_type end,
      pts[1 + i % 7], h.name || ', ' || h.address, ts, 1 + i % 3, 1 + i % 4, x.vehicle_class,
      case when x.price_type = 'on_request' then 'agreed' else x.price_type end, coalesce(x.price_amount, case when x.price_type = 'on_request' then 520 end),
      x.price_min, x.price_max, x.price_type <> 'estimate', x.payment_arrangement,
      case when i % 9 = 0 then 'cancelled' else 'completed' end,
      (array['qr_hotel', 'whatsapp', 'email_link', 'web'])[1 + i % 4], ts - interval '2 days',
      case when i % 9 <> 0 then ts + interval '50 minutes' end, case when i % 9 = 0 then ts - interval '1 day' end,
      case when i % 9 = 0 then 'Guest flight cancelled' end
    from public.hotel_transport_partners x join public.transport_providers pr on pr.id = x.provider_id join public.hotels h on h.id = x.hotel_id
    where x.id = o[hist_opt[1 + i % 10]];
  end loop;

  -- Driver assignments for the completed journeys (approved driver of the provider).
  insert into public.booking_drivers (booking_id, driver_id, vehicle_id, active, assigned_at)
  select b.id, d.id, v.id, false, b.pickup_at - interval '3 hours'
  from public.bookings b
  cross join lateral (select id from public.drivers where provider_id = b.provider_id and status in ('approved', 'suspended') order by id limit 1) d
  cross join lateral (select id from public.vehicles where provider_id = b.provider_id order by seats desc limit 1) v
  where b.status = 'completed';
  insert into public.verification_attempts (booking_id, outcome, created_at)
  select id, 'verified', pickup_at + interval '6 minutes' from public.bookings where status = 'completed';

  -- ---- Historical incidents. Includes a recurring pattern of extra-payment
  -- requests at International Arrivals (for the safety-intelligence demo).
  cats := array['extra_payment', 'driver_mismatch', 'extra_payment', 'cannot_locate_driver', 'suspected_scam', 'extra_payment',
                'vehicle_mismatch', 'code_incorrect', 'intimidation', 'other', 'driver_mismatch', 'cannot_locate_driver', 'extra_payment', 'suspected_scam'];
  for i in 1..14 loop
    select * into bk from public.bookings where status = 'completed' order by created_at desc offset (i * 2) % 25 limit 1;
    ts := case when cats[i] = 'extra_payment' and i <= 6 then now() - make_interval(days => 3 + i * 2, hours => i)
               else now() - make_interval(days => 4 + i * 3, hours => i * 2) end;
    st := case when i <= 2 then 'hotel_pending' when i <= 4 then 'follow_up' when i = 5 then 'escalated' when i = 6 then 'referred_authorities' else 'resolved' end;
    insert into public.incidents (reference, booking_id, hotel_id, provider_id, tourist_id, category, description, pickup_point_id,
      location_text, needs_immediate_help, status, created_at, updated_at, closed_at, police_case_number, police_station)
    values ('SAFE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.incident_ref_seq')::text, 4, '0'),
      case when cats[i] in ('suspected_scam', 'other') and i % 2 = 0 then null else bk.id end, bk.hotel_id,
      case when cats[i] in ('suspected_scam', 'other') and i % 2 = 0 then null else bk.provider_id end, bk.tourist_id, cats[i],
      case cats[i]
        when 'extra_payment' then 'A man at the pickup area said there was an extra "airport fee" of R200 in cash before he would load our bags.'
        when 'driver_mismatch' then 'Someone held a sign with my name but could not say the verification code.'
        when 'cannot_locate_driver' then 'Could not find the driver at the meeting point for 20 minutes.'
        when 'suspected_scam' then 'Approached inside the terminal by a person offering a "hotel shuttle" for cash.'
        when 'vehicle_mismatch' then 'Car registration was different to the one in my booking.'
        when 'code_incorrect' then 'Driver gave a wrong code, then said the system was broken.'
        when 'intimidation' then 'Driver became aggressive when I asked to check the registration.'
        else 'Driver took a much longer route than expected.' end,
      case when cats[i] = 'extra_payment' and i <= 6 then 'cpt-intl' else pts[1 + i % 7] end,
      null, cats[i] = 'intimidation', st, ts, ts + interval '1 day',
      case when st = 'resolved' then ts + interval '3 days' end,
      case when st = 'referred_authorities' then 'CAS 214/' || to_char(now(), 'MM/YYYY') end,
      case when st = 'referred_authorities' then 'Cape Town Central (demo)' end)
    returning id into inc;
    insert into public.incident_updates (incident_id, status, message, created_at) values
      (inc, 'received', 'Your report has been received and logged.', ts),
      (inc, 'hotel_notified', 'Your hotel has been notified.', ts + interval '1 minute'),
      (inc, 'hotel_pending', 'Waiting for your hotel to respond.', ts + interval '2 minutes');
    if st <> 'hotel_pending' then
      insert into public.incident_updates (incident_id, status, message, author_label, created_at) values
        (inc, 'follow_up', 'Hotel staff acknowledged the report and contacted the guest.', 'Hotel staff', ts + interval '25 minutes');
    end if;
    if st in ('escalated', 'referred_authorities', 'resolved') then
      insert into public.incident_updates (incident_id, status, message, author_label, created_at) values
        (inc, 'escalated', 'Escalated to the transport provider''s safety team.', 'Safety team', ts + interval '3 hours');
    end if;
    if st = 'referred_authorities' then
      insert into public.incident_updates (incident_id, status, message, author_label, created_at) values
        (inc, 'referred_authorities', 'Guest opened a case with SAPS; the external case number has been recorded.', 'Safety team', ts + interval '1 day');
    end if;
    if st = 'resolved' then
      insert into public.incident_updates (incident_id, status, message, author_label, created_at) values
        (inc, 'resolved', 'Provider reviewed the trip and followed up with the driver. Report resolved.', 'Safety team', ts + interval '3 days');
    end if;
  end loop;
  insert into public.verification_attempts (booking_id, outcome, created_at)
  select booking_id, case category when 'vehicle_mismatch' then 'wrong_vehicle' when 'driver_mismatch' then 'details_mismatch'
                       when 'code_incorrect' then 'code_mismatch' else 'cannot_find' end, created_at - interval '2 minutes'
  from public.incidents where booking_id is not null and category in ('vehicle_mismatch', 'driver_mismatch', 'code_incorrect', 'cannot_locate_driver');

  -- ---- Upcoming bookings at different stages (so every dashboard has work).
  insert into public.bookings (reference, tourist_id, hotel_id, provider_id, partner_id, transport_type, pickup_point_id, destination, pickup_at,
    flight_number, passengers, luggage, vehicle_class, price_type, price_amount, price_min, price_max, price_confirmed, payment_arrangement, status, source)
  values
    ('CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'), t[2], h1, p1, o[1], 'hotel', 'cpt-intl',
      'Saltwater Lodge, 12 Beach Road, Sea Point', date_trunc('hour', now()) + interval '5 hours', 'BA59', 1, 2, 'Sedan', 'agreed', 450, null, null, false,
      'Charged to your room by Saltwater Lodge — nothing to pay the driver', 'pending', 'qr_hotel'),
    ('CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'), t[1], h2, p6, o[4], 'hotel', 'cpt-intl',
      'Quayside Grand Hotel, 3 Dock Road, V&A Waterfront', date_trunc('hour', now()) + interval '1 day 2 hours', 'LH576', 2, 2, 'Executive sedan', 'agreed', 550, null, null, true,
      'Included in your Quayside Grand reservation', 'confirmed', 'email_link'),
    ('CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'), t[3], h2, p2, o[5], 'shuttle', 'cpt-intl',
      'Quayside Grand Hotel, 3 Dock Road, V&A Waterfront', date_trunc('hour', now()) + interval '1 day 6 hours', 'EK772', 4, 5, 'Minibus', 'agreed', 600, null, null, false,
      'Charged to your room by Quayside Grand Hotel', 'awaiting_provider', 'whatsapp'),
    ('CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'), t[5], h3, p3, o[8], 'shuttle', 'cpt-intl',
      'Bo-Kaap Lantern Guesthouse, 45 Wale Street, Bo-Kaap', date_trunc('hour', now()) + interval '3 hours', 'QR1369', 2, 3, 'Minibus', 'agreed', 480, null, null, true,
      'Paid to Peninsula Airport Shuttles in advance by secure card link — nothing to pay the driver', 'confirmed', 'qr_hotel'),
    ('CT-TRIP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.booking_ref_seq')::text, 3, '0'), t[4], h1, p2, o[2], 'shuttle', 'cpt-dom',
      'Saltwater Lodge, 12 Beach Road, Sea Point', date_trunc('hour', now()) - interval '20 minutes', null, 5, 6, 'Minibus', 'agreed', 620, null, null, true,
      'Charged to your room by Saltwater Lodge — nothing to pay the driver', 'confirmed', 'web');

  -- Booking 4 gets a driver + live code; booking 5 is mid-ride.
  select * into bk from public.bookings where tourist_id = t[5] and status = 'confirmed';
  perform private.do_assign(bk, d4, v4);
  select * into bk from public.bookings where tourist_id = t[4] and status = 'confirmed';
  perform private.do_assign(bk, d2, v2);
  insert into public.verification_attempts (booking_id, outcome) values (bk.id, 'verified');
  perform private.end_code(bk.id, 'used');
  update public.bookings set status = 'in_progress' where id = bk.id;

  insert into public.booking_tokens (booking_id) select id from public.bookings on conflict do nothing;

  insert into public.notifications (channel, recipient_type, kind, title, body, booking_id, hotel_id, created_at)
  select 'dashboard', 'hotel', 'booking_request', 'New transport request · ' || reference, 'Awaiting your confirmation', id, hotel_id, now() - interval '20 minutes'
  from public.bookings where status = 'pending';
  insert into public.notifications (channel, recipient_type, kind, title, body, booking_id, provider_id, created_at)
  select 'dashboard', 'provider', 'booking_request', 'New booking request · ' || reference, 'Quayside Grand Hotel guest', id, provider_id, now() - interval '1 hour'
  from public.bookings where status = 'awaiting_provider';
end $$;

-- Admin-only reset used by the presenter's "Reset demo" button.
-- Refuses to run unless app_settings.demo_mode is true.
create or replace function public.reset_demo() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce((select value from public.app_settings where key = 'demo_mode'), 'false') <> 'true'::jsonb then
    raise exception 'reset_demo is disabled outside demo mode';
  end if;
  perform private.require_admin();
  -- Keep real (non-demo) users' profiles across the reset.
  create temp table keep_profiles on commit drop as
    select * from public.profiles where id::text not like 'f0000000-0000-4000-8000-%';
  truncate public.notifications, public.audit_logs, public.incident_evidence, public.incident_updates, public.incidents,
    public.verification_attempts, public.verification_codes, public.booking_drivers, public.bookings, public.tourists,
    public.hotel_transport_partners, public.vehicles, public.drivers, public.provider_service_areas,
    public.profiles, public.transport_providers, public.hotels, public.whatsapp_sessions cascade;
  perform setval('public.booking_ref_seq', 1, false);
  perform setval('public.incident_ref_seq', 1, false);
  perform private.seed_demo_data();
  insert into public.profiles (id, full_name, email, role, hotel_id, provider_id, driver_id, created_at)
  select k.id, k.full_name, k.email,
    case when (k.role = 'hotel_staff' and h.id is null) or (k.role = 'provider_staff' and p.id is null) or (k.role = 'driver' and d.id is null) then 'tourist' else k.role end,
    h.id, p.id, d.id, k.created_at
  from keep_profiles k
  left join public.hotels h on h.id = k.hotel_id
  left join public.transport_providers p on p.id = k.provider_id
  left join public.drivers d on d.id = k.driver_id
  on conflict (id) do nothing;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
