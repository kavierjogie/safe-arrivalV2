-- 5/5  Storage buckets (Supabase only — skipped in the in-browser demo database).
--   incident-evidence: PRIVATE. Anyone may upload (reports are anonymous), nobody can
--                      list or read directly; staff who can see the incident get short-lived signed URLs.
--   driver-photos:     public-read with random UUID file names, so a tourist's booking
--                      page can show the photo without an account. Writes need a login.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present — skipping buckets';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('incident-evidence', 'incident-evidence', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
    ('driver-photos', 'driver-photos', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$create policy "evidence upload" on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'incident-evidence')$p$;
  execute $p$create policy "evidence read by staff" on storage.objects for select to authenticated
    using (bucket_id = 'incident-evidence' and exists (
      select 1 from public.incident_evidence e where e.storage_path = name and app.can_see_incident(e.incident_id)))$p$;
  execute $p$create policy "driver photo upload by partners" on storage.objects for insert to authenticated
    with check (bucket_id = 'driver-photos' and app.role() in ('admin', 'hotel_staff', 'provider_staff'))$p$;
end $$;
