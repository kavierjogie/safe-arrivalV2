-- 10  Defence in depth: staff/admin RPCs already check the caller's role, but anonymous visitors
--    never need them, so remove anon's EXECUTE. A role-check bug can then only be reached by a
--    signed-in user. Anonymous RPCs kept: booking/trip/verification/report/incident by token,
--    alert self-service by token, and mcp_call (MCP server; guarded by its secret).
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('add_driver', 'add_vehicle', 'admin_ai_overview', 'assign_driver', 'assign_incident_handler',
      'cancel_booking', 'change_booking_option', 'confirm_booking', 'decline_booking', 'mark_notifications_read', 'my_trip_links',
      'register_hotel', 'register_provider', 'reset_demo', 'save_partner_option', 'set_booking_price', 'set_incident_verification',
      'set_mcp_dataset', 'set_partner_status', 'set_police_reference', 'update_incident', 'update_trip_status')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
