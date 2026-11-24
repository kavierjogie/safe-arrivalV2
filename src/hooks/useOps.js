import { useMemo } from 'react'
import { useTables } from '../context/AppContext'

const TABLES = ['bookings', 'tourists', 'hotels', 'transport_providers', 'hotel_transport_partners', 'drivers', 'vehicles',
  'booking_drivers', 'verification_attempts', 'incidents', 'incident_updates', 'incident_evidence', 'pickup_points', 'profiles']

/** Everything a staff dashboard needs, already filtered by RLS for the signed-in role, plus lookups. */
export function useOps() {
  const t = useTables(TABLES)
  return useMemo(() => {
    const by = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]))
    const ix = { hotel: by(t.hotels), provider: by(t.transport_providers), tourist: by(t.tourists), driver: by(t.drivers),
      vehicle: by(t.vehicles), point: by(t.pickup_points), profile: by(t.profiles), booking: by(t.bookings) }
    const activeAssignment = (bookingId) => t.booking_drivers.find((a) => a.booking_id === bookingId && a.active)
      ?? t.booking_drivers.filter((a) => a.booking_id === bookingId).sort((a, b) => b.assigned_at.localeCompare(a.assigned_at))[0]
    return { ...t, ix, activeAssignment }
  }, [t])
}
