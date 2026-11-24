import { useState } from 'react'
import { toast } from 'sonner'
import { Building2, Car, IdCard, Plus } from 'lucide-react'
import { useOps } from '../../hooks/useOps'
import { rpc } from '../../services/api'
import { PageHeader } from '../../components/layout/Layouts'
import { Button, Field, Modal, Panel, inputCls } from '../../components/common/ui'
import { PartnerStatusBadge } from '../../components/common/StatusBadges'
import { DriverPhoto } from '../../components/tourist/TripBits'
import { PROVIDER_TYPE } from '../../lib/labels'

const ACTIONS = {
  hotel: [['active', 'Approve', 'safe'], ['suspended', 'Suspend', 'danger']],
  provider: [['active', 'Approve', 'safe'], ['suspended', 'Suspend', 'danger']],
  driver: [['approved', 'Approve', 'safe'], ['rejected', 'Reject', 'outline'], ['suspended', 'Suspend', 'danger']],
}

function StatusActions({ kind, row }) {
  const [note, setNote] = useState(null)
  const set = async (status, n) => {
    try { await rpc('set_partner_status', { p_kind: kind, p_id: row.id, p_status: status, p_note: n ?? null }); toast.success(`${kind[0].toUpperCase() + kind.slice(1)} ${status}`) } catch (e) { toast.error(e.message) }
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {ACTIONS[kind].filter(([s]) => s !== row.status).map(([s, label, v]) => (
        <Button key={s} size="sm" variant={v} onClick={() => (kind === 'driver' && s !== 'approved' ? setNote(s) : set(s))}>{label}</Button>
      ))}
      <Modal open={Boolean(note)} onClose={() => setNote(null)} title={`${note === 'rejected' ? 'Reject' : 'Suspend'} ${row.full_name}`}>
        <form onSubmit={(e) => { e.preventDefault(); set(note, e.target.reason.value); setNote(null) }} className="space-y-3">
          <Field label="Reason (shared with the provider)"><textarea name="reason" className={inputCls} rows={3} required minLength={3} maxLength={300} /></Field>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setNote(null)}>Cancel</Button><Button type="submit" variant="danger">Confirm</Button></div>
        </form>
      </Modal>
    </div>
  )
}

function RegisterForm({ kind, onClose }) {
  const submit = async (e) => {
    e.preventDefault()
    const p = Object.fromEntries(new FormData(e.target))
    try { await rpc(kind === 'hotel' ? 'register_hotel' : 'register_provider', { p }); toast.success('Registered as pending. Approve it once checks are complete.'); onClose() } catch (err) { toast.error(err.message) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Name"><input name="name" className={inputCls} required minLength={2} /></Field>
      {kind === 'hotel' ? (<>
        <Field label="Slug (for /start?hotel=…)"><input name="slug" className={inputCls} required pattern="[a-z0-9-]{3,40}" placeholder="hotel-005" /></Field>
        <Field label="Short code (for /s/…)"><input name="short_code" className={inputCls} required pattern="[a-z0-9]{2,12}" placeholder="abc" /></Field>
        <Field label="Area"><input name="area" className={inputCls} required /></Field>
        <Field label="Address"><input name="address" className={inputCls} /></Field>
        <Field label="Phone"><input name="phone" className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" className={inputCls} /></Field>
      </>) : (<>
        <Field label="Type"><select name="provider_type" className={inputCls}><option value="shuttle">Shuttle company</option><option value="hotel_fleet">Hotel fleet</option></select></Field>
        <Field label="Phone"><input name="contact_phone" className={inputCls} /></Field>
        <Field label="Email"><input name="contact_email" type="email" className={inputCls} /></Field>
        <Field label="Safety contact"><input name="safety_contact" className={inputCls} /></Field>
      </>)}
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Register</Button></div>
    </form>
  )
}

export default function AdminPartnersPage() {
  const ops = useOps()
  const [tab, setTab] = useState('drivers')
  const [reg, setReg] = useState(null)
  const pending = { hotels: ops.hotels.filter((h) => h.status === 'pending').length, providers: ops.transport_providers.filter((p) => p.status === 'pending').length, drivers: ops.drivers.filter((d) => d.status === 'pending').length }
  const tabs = [['drivers', 'Drivers', IdCard], ['providers', 'Transport providers', Car], ['hotels', 'Hotels', Building2]]
  const sortPending = (rows) => [...rows].sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0))

  return (
    <>
      <PageHeader title="Partner management" subtitle="Only approved partners and drivers can take tourist bookings. Every decision is audit-logged.">
        <Button variant="outline" onClick={() => setReg('hotel')}><Plus className="size-4" aria-hidden />Register hotel</Button>
        <Button variant="outline" onClick={() => setReg('provider')}><Plus className="size-4" aria-hidden />Register provider</Button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([k, l, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${tab === k ? 'bg-navy text-white' : 'bg-white text-muted ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            <Icon className="size-4" aria-hidden />{l}{pending[k] > 0 && <span className="rounded-full bg-amber px-1.5 text-[11px] font-bold text-navy">{pending[k]} pending</span>}
          </button>
        ))}
      </div>

      <Panel>
        <ul className="divide-y divide-slate-100">
          {tab === 'drivers' && sortPending(ops.drivers).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <DriverPhoto path={d.photo_path} name={d.full_name} size="size-11" />
              <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{d.full_name}</p><p className="text-xs text-muted">{ops.ix.provider[d.provider_id]?.name} · {d.phone}</p>{d.review_note && <p className="text-xs text-alert-ink">{d.review_note}</p>}</div>
              <PartnerStatusBadge status={d.status} /><StatusActions kind="driver" row={d} />
            </li>
          ))}
          {tab === 'providers' && sortPending(ops.transport_providers).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{p.name}</p><p className="text-xs text-muted">{PROVIDER_TYPE[p.provider_type]}{p.integration === 'uber_central' ? ' · simulated integration' : ''} · {ops.drivers.filter((d) => d.provider_id === p.id).length} drivers · {p.contact_email ?? '—'}</p></div>
              <PartnerStatusBadge status={p.status} /><StatusActions kind="provider" row={p} />
            </li>
          ))}
          {tab === 'hotels' && sortPending(ops.hotels).map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{h.name}</p><p className="text-xs text-muted">{h.area} · /start?hotel={h.slug} · /s/{h.short_code}</p></div>
              <PartnerStatusBadge status={h.status} /><StatusActions kind="hotel" row={h} />
            </li>
          ))}
        </ul>
      </Panel>
      <Modal open={Boolean(reg)} onClose={() => setReg(null)} title={reg === 'hotel' ? 'Register a hotel' : 'Register a transport provider'} wide>{reg && <RegisterForm kind={reg} onClose={() => setReg(null)} />}</Modal>
    </>
  )
}
