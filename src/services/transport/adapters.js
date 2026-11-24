// Transport-provider integration layer. Hotel fleets and shuttle partners are
// "manual" adapters: their staff act in the dashboards, and every action is a
// validated RPC. Uber Central is integration-ready but SIMULATED here: no call
// leaves the browser, and the booking is flagged `external_simulated`.
import { rpc } from '../api'

const manual = {
  createBooking: (booking, { price } = {}) => rpc('confirm_booking', { p_booking: booking.id, p_price: price ?? null }),
  getBookingStatus: async (booking) => booking.status,
  cancelBooking: (booking, reason) => rpc('cancel_booking', { p_booking: booking.id, p_reason: reason }),
  // Issues a fresh one-time code; it is delivered to the tourist and the driver over WhatsApp only.
  assignDriver: (booking, driverId, vehicleId) => rpc('assign_driver', { p_booking: booking.id, p_driver: driverId, p_vehicle: vehicleId }),
  sendDriverInstructions: async () => ({ channel: 'driver WhatsApp', simulated: true }),
}

const uberCentralMock = {
  ...manual,
  // Real version: POST to the Uber Central/Business API from a server function with the
  // hotel's organisation credentials, store the returned trip id in bookings.external_ref.
  createBooking: (booking, opts) => manual.createBooking(booking, opts),
  getBookingStatus: async (booking) => (booking.external_simulated ? `${booking.status} (simulated)` : booking.status),
  // Open question to confirm with Uber: whether trip notes / rider messages reach the driver
  // reliably enough to carry the verification code. Until confirmed, this stays simulated.
  sendDriverInstructions: async () => ({ channel: 'Uber trip instructions', simulated: true, confirmedSupported: false }),
}

export function getAdapter(provider) {
  return provider?.integration === 'uber_central' ? uberCentralMock : manual
}
export const ADAPTER_NOTE = {
  manual: 'Managed in this platform by the provider’s staff.',
  uber_central: 'Uber Central adapter — simulated. Integration-ready, pending approved API access.',
}
