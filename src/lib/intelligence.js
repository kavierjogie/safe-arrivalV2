// Finds recurring patterns in incident reports. Wording deliberately treats
// them as unverified reports, never as proven criminal activity.
import { INCIDENT_CATEGORY, VERIFY_FAILURES } from './labels'

const DAY = 86400e3
const PLURAL = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const CATEGORY_PHRASE = {
  extra_payment: 'unexpected additional payment requests', driver_mismatch: 'drivers not matching the booking',
  vehicle_mismatch: 'vehicles not matching the booking', code_incorrect: 'incorrect verification codes',
  suspected_scam: 'suspected scams', intimidation: 'intimidation by a driver', cannot_locate_driver: 'guests unable to find their driver',
  other: 'other problems',
}

export function findPatterns({ incidents, attempts = [], bookings = [], points, providers, days = 30, min = 3 }) {
  const since = Date.now() - days * DAY
  const recent = incidents.filter((i) => new Date(i.created_at) >= since)
  const out = []
  const group = (rows, key) => rows.reduce((m, r) => { const k = key(r); if (k) (m[k] ??= []).push(r); return m }, {})

  for (const [k, rows] of Object.entries(group(recent, (i) => i.pickup_point_id && `${i.pickup_point_id}|${i.category}`))) {
    if (rows.length < min) continue
    const [pt, cat] = k.split('|')
    out.push({ id: `loc-${k}`, count: rows.length, severity: ['intimidation', 'extra_payment', 'suspected_scam'].includes(cat) ? 'high' : 'medium',
      text: `${rows.length} complaints involving ${CATEGORY_PHRASE[cat] ?? INCIDENT_CATEGORY[cat]} were reported at ${points[pt]?.name ?? 'the same pickup location'} in the last ${days} days.`,
      action: cat === 'extra_payment' ? 'Consider signage at this pickup point and a reminder message to guests that no extra cash payments are due.' : 'Review these reports together with the hotels and providers involved.',
      incidentIds: rows.map((r) => r.id) })
  }
  for (const [k, rows] of Object.entries(group(recent, (i) => i.provider_id && `${i.provider_id}|${i.category}`))) {
    if (rows.length < 2) continue
    const [pv, cat] = k.split('|')
    out.push({ id: `prov-${k}`, count: rows.length, severity: 'medium',
      text: `${PLURAL(rows.length, 'report')} of ${CATEGORY_PHRASE[cat] ?? INCIDENT_CATEGORY[cat]} on trips by ${providers[pv]?.name ?? 'one provider'}.`,
      action: 'Share with the provider’s safety contact for review.', incidentIds: rows.map((r) => r.id) })
  }
  const bookingPoint = Object.fromEntries(bookings.map((b) => [b.id, b.pickup_point_id]))
  const fails = attempts.filter((a) => VERIFY_FAILURES.includes(a.outcome) && new Date(a.created_at) >= since)
  for (const [pt, rows] of Object.entries(group(fails, (a) => bookingPoint[a.booking_id]))) {
    if (rows.length < min) continue
    out.push({ id: `ver-${pt}`, count: rows.length, severity: 'medium',
      text: `${rows.length} driver verification failures at ${points[pt]?.name ?? 'one pickup point'}. Guests reported a code, driver or vehicle that didn’t match.`,
      action: 'Possible impersonation attempts. Check how pickups at this location are signposted and supervised.', incidentIds: [] })
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'high' ? -1 : 1))
}
