// Display labels and plain-English explanations shared by every view.
import { format, formatDistanceToNowStrict } from 'date-fns'

export const BOOKING_STATUS = {
  pending: 'Pending',
  awaiting_provider: 'Awaiting provider confirmation',
  confirmed: 'Confirmed',
  driver_assigned: 'Driver assigned',
  driver_on_way: 'Driver on the way',
  driver_arrived: 'Driver arrived',
  in_progress: 'Ride in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
export const BOOKING_FLOW = ['pending', 'confirmed', 'driver_assigned', 'driver_on_way', 'driver_arrived', 'in_progress', 'completed']
export const ACTIVE_BOOKING = ['pending', 'awaiting_provider', 'confirmed', 'driver_assigned', 'driver_on_way', 'driver_arrived', 'in_progress']

export const TRANSPORT_TYPE = { hotel: 'Hotel-arranged transport', shuttle: 'Partnered shuttle', ehailing: 'E-hailing (Uber Central)' }

export const PRICE_TYPE = {
  agreed: 'Agreed price',
  estimate: 'Estimated price',
  on_request: 'Price requires provider confirmation',
}

export const INCIDENT_CATEGORY = {
  driver_mismatch: 'Driver does not match',
  code_incorrect: 'Verification code incorrect',
  vehicle_mismatch: 'Vehicle does not match',
  extra_payment: 'Driver asking for additional payment',
  suspected_scam: 'Suspected scam',
  intimidation: 'Driver threatening or intimidating me',
  cannot_locate_driver: 'I cannot locate my driver',
  other: 'Other incident',
  listing_mismatch: 'Accommodation not as advertised',
  booking_payment_fraud: 'Suspicious booking or payment request',
  host_identity_mismatch: 'Provider identity or contacts inconsistent',
  accommodation_unsafe: 'Felt unsafe at accommodation',
  accommodation_other: 'Other accommodation problem',
}

export const SERVICE = { accommodation: 'Accommodation', transport: 'Transport', incident: 'Incident reporting', guidance: 'Safety guidance' }
export const CHANNEL = { whatsapp: 'WhatsApp', mcp: 'ChatGPT / MCP' }
export const SAFETY_SCALE = { 1: 'Very unsafe', 2: 'Unsafe', 3: 'Neutral', 4: 'Safe', 5: 'Very safe' }
export const FEEDBACK_QUESTION = {
  driver_matched: 'Driver matched the booking', vehicle_matched: 'Vehicle matched', pickup_safe: 'Felt safe at pickup',
  price_respected: 'Agreed price respected', journey_safe: 'Felt safe during the journey',
  matched_description: 'Accommodation matched its description', provider_consistent: 'Provider identity/contacts consistent',
  checkin_safe: 'Felt safe at check-in', payment_clear: 'Payment instructions clear', felt_uncomfortable: 'Something felt uncomfortable',
  reporting_easy: 'Reporting was easy', next_steps_clear: 'Next steps were clear', received_update: 'Received an update',
  communication_ok: 'Satisfied with communication', easy_to_use: 'Easy to use', safer_decision: 'Helped a safer decision',
}
// [label, unit, higher-is-better default]
export const KPI = {
  accommodation_verification_rate: ['Accommodation verification rate', '%'],
  transport_verification_rate: ['Transport verification rate', '%'],
  incident_ack_minutes: ['Incident acknowledgement time', 'min'],
  incident_followup_rate: ['Incident follow-up rate', '%'],
  avg_safety_rating: ['Average perceived safety rating', '/5'],
  avg_overall_rating: ['Average overall experience rating', '/5'],
  confidence_rate: ['Visitors who felt more confident', '%'],
  feedback_response_rate: ['Feedback response rate', '%'],
}
export const GOAL_STATUS = { achieved: ['Achieved', 'green'], on_track: ['On track', 'green'], at_risk: ['At risk', 'amber'], missed: ['Missed', 'red'],
  not_started: ['Not started', 'slate'], no_data: ['No data yet', 'slate'] }

export const INCIDENT_STATUS = {
  received: ['Report received', 'Your report is logged and has an internal reference.'],
  hotel_notified: ['Hotel notified', 'Your hotel has been alerted to the report.'],
  hotel_pending: ['Hotel response pending', 'Waiting for hotel staff to respond. They usually reply quickly during your arrival window.'],
  provider_notified: ['Transport provider notified', 'The transport company involved has been told about the report.'],
  escalated: ['Escalated to provider safety team', 'The provider’s safety team is reviewing the trip and the driver involved.'],
  referred_authorities: ['Referred to authorities', 'You were advised to report this to SAPS. Any official case number you share is recorded separately — this platform does not issue police case numbers.'],
  follow_up: ['Follow-up in progress', 'Staff have acknowledged your report and are following up with you.'],
  resolved: ['Resolved', 'The hotel or safety team consider this report resolved. You can still reply if it isn’t.'],
  closed: ['Closed', 'This report is closed by the safety team.'],
}
export const INCIDENT_OPEN = ['received', 'hotel_notified', 'hotel_pending', 'provider_notified', 'escalated', 'referred_authorities', 'follow_up']

export const VERIFY_OUTCOME = {
  verified: 'Driver verified',
  code_mismatch: 'Code does not match',
  details_mismatch: 'Driver details do not match',
  wrong_vehicle: 'Wrong vehicle',
  cannot_find: 'Cannot find driver',
  spoken_code_match: 'Typed code matched',
  spoken_code_mismatch: 'Typed code did not match',
}
export const VERIFY_FAILURES = ['code_mismatch', 'details_mismatch', 'wrong_vehicle', 'cannot_find', 'spoken_code_mismatch']

// Verification outcome → incident category the report form starts with.
export const OUTCOME_TO_CATEGORY = { code_mismatch: 'code_incorrect', details_mismatch: 'driver_mismatch', wrong_vehicle: 'vehicle_mismatch', cannot_find: 'cannot_locate_driver' }

export const PROVIDER_TYPE = { hotel_fleet: 'Hotel fleet', shuttle: 'Shuttle company', ehailing: 'E-hailing' }
export const PARTNER_STATUS = { pending: 'Pending approval', active: 'Active', suspended: 'Suspended', approved: 'Approved', rejected: 'Rejected' }

export const rand = (n) => `R${Math.round(Number(n)).toLocaleString('en-ZA')}`

/** { label, amount, tone, note } for a booking or a transport option. */
export function priceInfo(x) {
  if (!x) return null
  if (x.price_type === 'agreed') {
    const confirmed = x.price_confirmed ?? true
    return { label: confirmed ? 'Confirmed agreed price' : 'Agreed price', amount: rand(x.price_amount), tone: 'green',
      note: confirmed ? 'This is the full price. Do not pay the driver anything extra.' : 'Agreed with the hotel; confirmed when your booking is confirmed.' }
  }
  if (x.price_type === 'estimate') {
    return { label: 'Estimated price', amount: `${rand(x.price_min)}–${rand(x.price_max)}`, tone: 'amber',
      note: 'An estimate, not a guaranteed fare. The final e-hailing fare depends on traffic and demand.' }
  }
  return { label: 'Requires provider confirmation', amount: 'To be confirmed', tone: 'slate',
    note: 'The provider confirms the price before pickup. You will see it here before you travel.' }
}

export const fmt = (d, f = 'EEE d MMM, HH:mm') => (d ? format(new Date(d), f) : '—')
export const ago = (d) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : '—')
export const firstName = (n = '') => n.split(' ')[0]
export const initials = (n = '') => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export const PICKUP_TIPS = [
  'Go only to the designated pickup point shown in your booking.',
  'Check the registration number before you approach the vehicle.',
  'Let the driver say your verification code first. Never read it out yourself.',
  'If anything doesn’t match, stay inside the terminal and tap “Something’s wrong”.',
  'Never pay the driver extra in cash. Your price was agreed in advance.',
]

export const EMERGENCY_NUMBERS = [
  { label: 'Police (SAPS)', number: '10111' },
  { label: 'Ambulance', number: '10177' },
  { label: 'Any emergency from a mobile', number: '112' },
]
