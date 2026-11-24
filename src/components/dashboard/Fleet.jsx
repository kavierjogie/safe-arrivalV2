import { useState } from 'react'
import { toast } from 'sonner'
import { Car, IdCard, Plus } from 'lucide-react'
import { rpc, uploadPhoto } from '../../services/api'
import { Button, EmptyState, Field, Modal, Panel, inputCls } from '../common/ui'
import { PartnerStatusBadge } from '../common/StatusBadges'
import { DriverPhoto } from '../tourist/TripBits'

function AddDriver({ providers, onClose }) {
  const [f, setF] = useState({ provider_id: providers[0]?.id ?? '', full_name: '', phone: '', photo: null })
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const photo_path = f.photo ? await uploadPhoto('driver-photos', f.photo) : null
      await rpc('add_driver', { p: { provider_id: f.provider_id, full_name: f.full_name, phone: f.phone, photo_path } })
      toast.success('Driver added. They can be assigned once the safety team approves them.')
      onClose()
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {providers.length > 1 && <Field label="Provider"><select className={inputCls} value={f.provider_id} onChange={(e) => setF({ ...f, provider_id: e.target.value })}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <Field label="Full name"><input className={inputCls} required minLength={2} maxLength={80} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
      <Field label="Mobile number" hint="Private. Shown to the guest only once the driver is on the way."><input className={inputCls} required inputMode="tel" placeholder="+27 82 000 0000" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Photo" hint="A clear, recent face photo. Guests use it to recognise the driver."><input type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => setF({ ...f, photo: e.target.files[0] })} /></Field>
      <p className="rounded-lg bg-amber/10 p-2 text-xs text-amber-ink">New drivers stay <strong>pending</strong> until the safety team approves them. No identity documents are uploaded here; the safety team records the outcome of its checks.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Add driver</Button></div>
    </form>
  )
}

function AddVehicle({ providers, onClose }) {
  const [f, setF] = useState({ provider_id: providers[0]?.id ?? '', make: '', model: '', colour: '', registration: '', vehicle_class: 'Sedan', seats: 4, luggage: 3 })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try { await rpc('add_vehicle', { p: f }); toast.success('Vehicle added'); onClose() } catch (err) { toast.error(err.message) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      {providers.length > 1 && <Field label="Provider"><select className={inputCls} value={f.provider_id} onChange={set('provider_id')}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <Field label="Make"><input className={inputCls} required value={f.make} onChange={set('make')} /></Field>
      <Field label="Model"><input className={inputCls} required value={f.model} onChange={set('model')} /></Field>
      <Field label="Colour"><input className={inputCls} required value={f.colour} onChange={set('colour')} /></Field>
      <Field label="Registration"><input className={inputCls} required minLength={4} maxLength={15} value={f.registration} onChange={set('registration')} placeholder="CA 000-000" /></Field>
      <Field label="Class"><select className={inputCls} value={f.vehicle_class} onChange={set('vehicle_class')}>{['Sedan', 'SUV', 'Executive sedan', 'Minibus'].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Passenger seats"><input type="number" min="1" max="22" className={inputCls} value={f.seats} onChange={set('seats')} /></Field>
      <Field label="Large bags"><input type="number" min="0" max="30" className={inputCls} value={f.luggage} onChange={set('luggage')} /></Field>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Add vehicle</Button></div>
    </form>
  )
}

/** Drivers and vehicles. `manageable` = providers the signed-in user may add to. */
export default function Fleet({ ops, providerIds, manageable = [] }) {
  const [modal, setModal] = useState(null)
  const drivers = ops.drivers.filter((d) => providerIds.includes(d.provider_id))
  const vehicles = ops.vehicles.filter((v) => providerIds.includes(v.provider_id))
  return (
    <div className="space-y-4">
      <Panel title={`Drivers (${drivers.length})`} action={manageable.length > 0 && <Button size="sm" onClick={() => setModal('driver')}><Plus className="size-4" aria-hidden />Add driver</Button>}>
        {drivers.length === 0 ? <EmptyState icon={IdCard} title="No drivers" /> : (
          <ul className="grid gap-px bg-slate-100 sm:grid-cols-2">
            {drivers.map((d) => (
              <li key={d.id} className="flex items-center gap-3 bg-white p-3">
                <DriverPhoto path={d.photo_path} name={d.full_name} size="size-12" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{d.full_name}</p>
                  <p className="truncate text-xs text-muted">{ops.ix.provider[d.provider_id]?.name}{d.phone ? ` · ${d.phone}` : ''}</p>
                  {d.review_note && <p className="text-xs text-alert-ink">{d.review_note}</p>}
                </div>
                <PartnerStatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={`Vehicles (${vehicles.length})`} action={manageable.length > 0 && <Button size="sm" variant="outline" onClick={() => setModal('vehicle')}><Plus className="size-4" aria-hidden />Add vehicle</Button>}>
        {vehicles.length === 0 ? <EmptyState icon={Car} title="No vehicles" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Registration</th><th className="px-3 py-2">Vehicle</th><th className="px-3 py-2">Class</th><th className="px-3 py-2">Capacity</th><th className="px-3 py-2">Provider</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.map((v) => (
                  <tr key={v.id}><td className="px-3 py-2 font-mono font-semibold">{v.registration}</td><td className="px-3 py-2">{v.colour} {v.make} {v.model}</td><td className="px-3 py-2">{v.vehicle_class}</td><td className="px-3 py-2">{v.seats} seats · {v.luggage} bags</td><td className="px-3 py-2">{ops.ix.provider[v.provider_id]?.name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Modal open={modal === 'driver'} onClose={() => setModal(null)} title="Add driver"><AddDriver providers={manageable} onClose={() => setModal(null)} /></Modal>
      <Modal open={modal === 'vehicle'} onClose={() => setModal(null)} title="Add vehicle" wide><AddVehicle providers={manageable} onClose={() => setModal(null)} /></Modal>
    </div>
  )
}
