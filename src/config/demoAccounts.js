// Seeded demo users (see supabase/seed.sql). In Supabase mode they sign in with
// the shared demo password; in demo mode no password is needed.
export const DEMO_PASSWORD = 'SafeArrival-Demo-2026'

export const DEMO_ACCOUNTS = [
  { id: 'f0000000-0000-4000-8000-000000000002', email: 'frontdesk@saltwaterlodge.demo', name: 'Fatima Isaacs', role: 'hotel_staff', org: 'Saltwater Lodge (Sarah’s hotel)' },
  { id: 'f0000000-0000-4000-8000-000000000001', email: 'admin@safearrival.demo', name: 'Nomsa Dlamini', role: 'admin', org: 'Safe Arrival safety team' },
  { id: 'f0000000-0000-4000-8000-000000000005', email: 'michael@saltwaterlodge.demo', name: 'Michael Daniels', role: 'driver', org: 'Saltwater Lodge Transfers' },
  { id: 'f0000000-0000-4000-8000-000000000004', email: 'dispatch@trustedshuttle.demo', name: 'Bongani Zulu', role: 'provider_staff', org: 'Cape Town Trusted Shuttle' },
  { id: 'f0000000-0000-4000-8000-000000000003', email: 'concierge@quaysidegrand.demo', name: 'Ryan Adams', role: 'hotel_staff', org: 'Quayside Grand Hotel' },
  { id: 'f0000000-0000-4000-8000-000000000006', email: 'ops@peninsulashuttles.demo', name: 'Chantal Jacobs', role: 'provider_staff', org: 'Peninsula Airport Shuttles' },
  { id: 'f0000000-0000-4000-8000-000000000007', email: 'thandi@trustedshuttle.demo', name: 'Thandi Nkosi', role: 'driver', org: 'Cape Town Trusted Shuttle' },
  { id: 'f0000000-0000-4000-8000-000000000008', email: 'safety@safearrival.demo', name: 'Lwazi Ndlovu', role: 'admin', org: 'Safe Arrival safety team' },
]

export const ROLE_LABEL = { admin: 'Administrator', hotel_staff: 'Hotel staff', provider_staff: 'Transport provider', driver: 'Driver', tourist: 'Tourist' }

// Sarah's details for the scripted demo.
export const DEMO_TOURIST = { full_name: 'Sarah Mitchell', whatsapp: '+44 7700 900123', hotel_slug: 'hotel-001' }
