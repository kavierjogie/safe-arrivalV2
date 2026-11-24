-- Demo users + demo data. Runs after the migrations (`supabase db reset` runs it automatically,
-- or paste it into the SQL editor). DEMO ONLY — delete these users before any real deployment.
-- Password for every demo account: SafeArrival-Demo-2026

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  extensions.crypt('SafeArrival-Demo-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v.name), now(), now(), '', '', '', ''
from (values
  ('f0000000-0000-4000-8000-000000000001', 'admin@safearrival.demo', 'Nomsa Dlamini'),
  ('f0000000-0000-4000-8000-000000000002', 'frontdesk@saltwaterlodge.demo', 'Fatima Isaacs'),
  ('f0000000-0000-4000-8000-000000000003', 'concierge@quaysidegrand.demo', 'Ryan Adams'),
  ('f0000000-0000-4000-8000-000000000004', 'dispatch@trustedshuttle.demo', 'Bongani Zulu'),
  ('f0000000-0000-4000-8000-000000000005', 'michael@saltwaterlodge.demo', 'Michael Daniels'),
  ('f0000000-0000-4000-8000-000000000006', 'ops@peninsulashuttles.demo', 'Chantal Jacobs'),
  ('f0000000-0000-4000-8000-000000000007', 'thandi@trustedshuttle.demo', 'Thandi Nkosi'),
  ('f0000000-0000-4000-8000-000000000008', 'safety@safearrival.demo', 'Lwazi Ndlovu')
) as v(id, email, name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u where u.id::text like 'f0000000-0000-4000-8000-%'
on conflict do nothing;

select private.seed_demo_data();
