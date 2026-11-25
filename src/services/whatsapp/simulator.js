// The engine's data API, backed by the same RPCs the production webhook uses.
// (The webhook implements this interface with the service-role client.)
import { rpc, select } from '../api'
import { BOOKING_STATUS, fmt, priceInfo } from '../../lib/labels'

export const simulatorApi = {
  hotels: async () => (await select('hotels', 'name')).filter((h) => h.status === 'active'),
  pickupPoints: () => select('pickup_points', 'kind, name'),
  async options(slug) {
    const [hotels, opts, providers] = await Promise.all([select('hotels', null), select('hotel_transport_partners', null), select('transport_providers', null)])
    const h = hotels.find((x) => x.slug === slug)
    return opts.filter((o) => o.hotel_id === h?.id && o.available)
      .map((o) => ({ ...o, provider: providers.find((p) => p.id === o.provider_id) }))
      .filter((o) => o.provider?.status === 'active')
      .map((o) => ({ ...o, provider_name: o.provider.name }))
      .sort((a, b) => (Number(a.price_amount ?? a.price_min ?? 9e9) - Number(b.price_amount ?? b.price_min ?? 9e9)))
  },
  createBooking: (p) => rpc('create_booking', { p }),
  getTrip: (token) => rpc('get_trip', { p_token: token }),
  recordVerification: (token, outcome) => rpc('record_verification', { p_token: token, p_outcome: outcome }),
  checkCode: (token, code) => rpc('check_spoken_code', { p_token: token, p_code: code }),
  reportIncident: (p) => rpc('report_incident', { p }),
  checkAccommodation: (p) => rpc('check_accommodation', { p }),
  checkProvider: (p) => rpc('check_transport_provider', { p }),
  getIncident: (token) => rpc('get_incident', { p_token: token }),
  guidance: (stage) => rpc('safety_guidance', { p_stage: stage }),
  requestFeedback: (p) => rpc('request_feedback', { p }),
  submitFeedback: (p) => rpc('submit_feedback', { p }),
  tripLink: (t) => `${location.origin}/trip/${t}`,
  incidentLink: (t) => `${location.origin}/incident/${t}`,
  statusLabel: (s) => BOOKING_STATUS[s] ?? s,
  fmtTime: (d) => fmt(d),
  priceText: (b) => { const p = priceInfo(b); return `${p.amount} (${p.label.toLowerCase()})` },
}
