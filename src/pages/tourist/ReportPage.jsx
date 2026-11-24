import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, Camera, Loader2, Send, Siren, X } from 'lucide-react'
import { rpc, select, uploadPhoto } from '../../services/api'
import { useLive } from '../../context/AppContext'
import { PublicPage } from '../../components/layout/Layouts'
import { Button, Field, inputCls, textareaCls } from '../../components/common/ui'
import { EmergencyNumbers, ReportHint } from '../../components/tourist/TripBits'
import { INCIDENT_CATEGORY } from '../../lib/labels'
import { rememberReport } from '../../lib/myTrips'

/** "Something's wrong": creates an incident immediately and returns its reference. */
export default function ReportPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('trip')
  const [category, setCategory] = useState(params.get('category') ?? '')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [pickup, setPickup] = useState('cpt-intl')
  const [hotel, setHotel] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)

  const { data: trip } = useLive(() => rpc('get_trip', { p_token: token }), [token], { enabled: Boolean(token) })
  const { data: dir } = useLive(async () => ({ hotels: (await select('hotels', 'name')).filter((h) => h.status === 'active'), points: await select('pickup_points', 'kind, name') }), [])

  const addPhoto = (e) => {
    const files = [...e.target.files].slice(0, 3 - photos.length)
    setPhotos((p) => [...p, ...files.map((f) => ({ file: f, url: URL.createObjectURL(f) }))])
    e.target.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!category) return toast.error('Please choose what went wrong')
    setBusy(true)
    try {
      const evidence = []
      for (const p of photos) evidence.push({ path: await uploadPhoto('incident-evidence', p.file), content_type: 'image/jpeg' })
      const r = await rpc('report_incident', { p: { booking_token: token, hotel_slug: hotel || null, category, description, location_text: location,
        pickup_point_id: token ? null : pickup, needs_immediate_help: urgent, evidence } })
      rememberReport({ token: r.access_token, reference: r.reference, created_at: new Date().toISOString() })
      navigate(`/incident/${r.access_token}?new=1`)
    } catch (err) {
      toast.error(err.message)
      setBusy(false)
    }
  }

  return (
    <PublicPage narrow>
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><AlertTriangle className="size-6 text-alert" aria-hidden />Something’s wrong</h1>
      <p className="mt-1 text-sm text-muted">{trip ? <>Reporting for booking <strong className="font-mono">{trip.booking.reference}</strong>. Your hotel and the transport provider will be alerted.</> : 'Tell us what happened. You don’t need a booking to report a suspicious driver.'}</p>

      <div className="mt-4 rounded-2xl border border-alert/30 bg-alert/5 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-alert-ink"><Siren className="size-4" aria-hidden />In immediate danger? Call now. Don’t wait for this form.</p>
        <EmergencyNumbers />
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">What happened?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(INCIDENT_CATEGORY).map(([k, label]) => (
              <label key={k} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium ${category === k ? 'border-alert bg-alert/5 ring-2 ring-alert/30' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <input type="radio" name="category" value={k} checked={category === k} onChange={() => setCategory(k)} className="size-4 accent-[var(--color-alert)]" />{label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${urgent ? 'border-alert bg-alert/10' : 'border-slate-200 bg-white'}`}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="mt-1 size-5 accent-[var(--color-alert)]" />
          <span><span className="block font-semibold">I need immediate assistance</span><span className="block text-sm text-muted">Your hotel sees this as urgent. If you are in danger, also call 10111 or 112.</span></span>
        </label>

        <Field label="Describe what happened (optional)">
          <textarea className={textareaCls} rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. A man said he was my driver, but the registration was different and he asked for cash." />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {!token && (
            <Field label="Where are you?">
              <select className={inputCls} value={pickup} onChange={(e) => setPickup(e.target.value)}>
                {dir?.points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="More location detail (optional)"><input className={inputCls} maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. near the exit doors" /></Field>
          {!token && (
            <Field label="Your hotel (optional)" hint="If you choose your hotel, they are alerted.">
              <select className={inputCls} value={hotel} onChange={(e) => setHotel(e.target.value)}>
                <option value="">Not listed / none</option>
                {dir?.hotels.map((h) => <option key={h.slug} value={h.slug}>{h.name}</option>)}
              </select>
            </Field>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">Photo (optional, up to 3)</p>
          <p className="mb-2 text-xs text-muted">e.g. the vehicle’s registration plate. Only take photos if it’s safe to do so. Photos are stored privately and shown only to the hotel and safety team.</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <span key={p.url} className="relative">
                <img src={p.url} alt={`Attached photo ${i + 1}`} className="size-20 rounded-lg object-cover" />
                <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-navy text-white" aria-label={`Remove photo ${i + 1}`}><X className="size-3.5" /></button>
              </span>
            ))}
            {photos.length < 3 && (
              <label className="grid size-20 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-slate-300 text-muted hover:bg-slate-50">
                <Camera className="size-6" aria-hidden /><span className="sr-only">Add photo</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={addPhoto} />
              </label>
            )}
          </div>
        </div>

        <Button type="submit" variant="danger" size="lg" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}Send report
        </Button>
        <ReportHint />
      </form>
    </PublicPage>
  )
}
