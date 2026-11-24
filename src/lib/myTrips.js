// Tourists don't log in. Their booking and report links (unguessable tokens)
// are remembered on this device so "My bookings" works without an account.
const KEY = 'sa-my-trips'
export const CHAT_KEY = 'sa-chat' // the simulated WhatsApp conversation on this device
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? { trips: [], reports: [] } } catch { return { trips: [], reports: [] } } }
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode: links still work this session */ } }

export const myTrips = () => read().trips
export const myReports = () => read().reports
export function rememberTrip(t) { const v = read(); write({ ...v, trips: [t, ...v.trips.filter((x) => x.token !== t.token)].slice(0, 20) }) }
export function rememberReport(r) { const v = read(); write({ ...v, reports: [r, ...v.reports.filter((x) => x.token !== r.token)].slice(0, 20) }) }
export const latestTrip = () => read().trips[0] ?? null
export const forgetAll = () => write({ trips: [], reports: [] })
