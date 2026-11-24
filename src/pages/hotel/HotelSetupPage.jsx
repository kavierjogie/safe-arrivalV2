import { useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { toast } from 'sonner'
import { BadgeCheck, Copy, Download, Mail, Pencil, Plus, Printer, ShieldAlert } from 'lucide-react'
import { useOps } from '../../hooks/useOps'
import { useApp } from '../../context/AppContext'
import { rpc } from '../../services/api'
import { PageHeader } from '../../components/layout/Layouts'
import { Badge } from '../../components/common/StatusBadges'
import { Button, Field, Modal, Panel, inputCls, inputW } from '../../components/common/ui'
import { WHATSAPP_BUSINESS_NAME, whatsappNumber } from '../../lib/supabase'
import { PRICE_TYPE, priceInfo } from '../../lib/labels'

function OptionForm({ initial, providers, hotelId, onClose }) {
  const [f, setF] = useState(initial ?? { provider_id: providers[0]?.id, vehicle_class: 'Sedan', passenger_capacity: 3, luggage_capacity: 3, price_type: 'agreed', price_amount: '', price_min: '', price_max: '', payment_arrangement: 'Charged to your room by the hotel. Nothing to pay the driver.', available: true })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const n = (v) => (v === '' || v == null ? null : Number(v))
    try {
      await rpc('save_partner_option', { p: { ...f, hotel_id: hotelId, price_amount: f.price_type === 'agreed' ? n(f.price_amount) : null,
        price_min: f.price_type === 'estimate' ? n(f.price_min) : null, price_max: f.price_type === 'estimate' ? n(f.price_max) : null } })
      toast.success('Transport option saved'); onClose()
    } catch (err) { toast.error(err.message) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Provider"><select className={inputCls} value={f.provider_id} onChange={set('provider_id')} disabled={Boolean(initial)}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Vehicle class"><input className={inputCls} value={f.vehicle_class} onChange={set('vehicle_class')} disabled={Boolean(initial)} required /></Field>
      <Field label="Passengers"><input type="number" min="1" max="22" className={inputCls} value={f.passenger_capacity} onChange={set('passenger_capacity')} /></Field>
      <Field label="Large bags"><input type="number" min="0" max="30" className={inputCls} value={f.luggage_capacity} onChange={set('luggage_capacity')} /></Field>
      <Field label="Price type"><select className={inputCls} value={f.price_type} onChange={set('price_type')}>{Object.entries(PRICE_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {f.price_type === 'agreed' && <Field label="Agreed price (R)"><input type="number" min="1" className={inputCls} value={f.price_amount ?? ''} onChange={set('price_amount')} required /></Field>}
      {f.price_type === 'estimate' && <Field label="Estimate range (R)"><span className="flex gap-2"><input type="number" min="1" className={inputCls} value={f.price_min ?? ''} onChange={set('price_min')} required aria-label="Minimum" /><input type="number" min="1" className={inputCls} value={f.price_max ?? ''} onChange={set('price_max')} required aria-label="Maximum" /></span></Field>}
      <Field label="Payment arrangement (shown to guests before they confirm)"><input className={inputCls} value={f.payment_arrangement} onChange={set('payment_arrangement')} required /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.available} onChange={set('available')} className="size-4" />Available to guests</label>
      <p className="text-xs text-muted sm:col-span-2">Only use “Agreed price” for a fixed price you’ve actually agreed with the provider. E-hailing should stay an estimate.</p>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Save option</Button></div>
    </form>
  )
}

export default function HotelSetupPage() {
  const ops = useOps()
  const { profile } = useApp()
  const [hotelId, setHotelId] = useState(null)
  const [edit, setEdit] = useState(null)
  const qrRef = useRef(null)
  const hotels = ops.hotels.filter((h) => profile?.role === 'admin' || h.id === profile?.hotel_id)
  const hotel = hotels.find((h) => h.id === hotelId) ?? hotels[0]
  if (!hotel) return null

  const shortUrl = `${location.origin}/s/${hotel.short_code}`
  const waLink = whatsappNumber ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`START ${hotel.slug}`)}` : `${location.origin}/start?hotel=${hotel.slug}`
  const email = `Arriving in Cape Town? Arrange trusted airport transport before you land:\n${waLink}\n\nYou'll get your driver's photo, vehicle registration and a one-time code. Your driver must say the code first. Before sharing any details, check that the WhatsApp account is “${WHATSAPP_BUSINESS_NAME}” with the verified badge.`
  const options = ops.hotel_transport_partners.filter((o) => o.hotel_id === hotel.id)
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast.success('Copied'))
  const download = () => {
    const a = document.createElement('a')
    a.href = qrRef.current.toDataURL('image/png')
    a.download = `${hotel.slug}-safe-arrival-qr.png`
    a.click()
  }

  return (
    <>
      <PageHeader title="QR code & pricing" subtitle="Your guest onboarding link and the transport options guests can book.">
        {hotels.length > 1 && <select className={inputW('w-auto')} value={hotel.id} onChange={(e) => setHotelId(e.target.value)} aria-label="Hotel">{hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Panel title="Printable QR poster" bodyClass="p-4">
          <div id="qr-poster" className="rounded-2xl border-2 border-navy p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-ink">{hotel.name}</p>
            <p className="mt-1 text-lg font-bold">Arriving in Cape Town?</p>
            <p className="text-sm">Arrange trusted transport and verify your driver</p>
            <div className="mt-3 inline-block rounded-xl bg-white p-2 ring-1 ring-slate-200"><QRCodeCanvas ref={qrRef} value={shortUrl} size={200} marginSize={2} level="M" /></div>
            <p className="mt-2 font-mono text-sm font-semibold">{shortUrl.replace(/^https?:\/\//, '')}</p>
            <div className="mt-3 rounded-lg bg-canvas p-2 text-left text-xs">
              <p className="flex items-center gap-1 font-semibold"><ShieldAlert className="size-3.5" aria-hidden />Before sharing any details, check:</p>
              <p className="mt-1 flex items-center gap-1"><BadgeCheck className="size-3.5 text-teal" aria-hidden />WhatsApp name: <strong>{WHATSAPP_BUSINESS_NAME}</strong> (verified)</p>
              <p className="flex items-center gap-1"><BadgeCheck className="size-3.5 text-teal" aria-hidden />Web address: <strong>{location.host}</strong></p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={download}><Download className="size-4" aria-hidden />Download QR (PNG)</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" aria-hidden />Print poster</Button>
          </div>
          <p className="mt-2 text-xs text-muted">A QR code alone doesn’t prove authenticity, because stickers can be swapped. That’s why the poster teaches guests to check the verified WhatsApp name and the address.</p>
        </Panel>

        <div className="space-y-4">
          <Panel title="Links" bodyClass="space-y-3 p-4 text-sm">
            {[['Short link (QR target)', shortUrl], ['Onboarding link', `${location.origin}/start?hotel=${hotel.slug}`], [whatsappNumber ? 'WhatsApp deep link' : 'WhatsApp link (simulated until a number is configured)', waLink]].map(([l, v]) => (
              <div key={l}><p className="text-xs font-medium text-muted">{l}</p><p className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-mono">{v}</span><button onClick={() => copy(v)} className="rounded p-1 hover:bg-slate-100" aria-label={`Copy ${l}`}><Copy className="size-4" /></button></p></div>
            ))}
          </Panel>
          <Panel title={<span className="flex items-center gap-1.5"><Mail className="size-4" aria-hidden />Text for booking confirmation emails</span>} action={<Button size="sm" variant="outline" onClick={() => copy(email)}><Copy className="size-4" aria-hidden />Copy</Button>} bodyClass="p-4">
            <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{email}</p>
          </Panel>
          <Panel title="Transport options & pricing" action={<Button size="sm" onClick={() => setEdit('new')}><Plus className="size-4" aria-hidden />Add option</Button>}>
            <ul className="divide-y divide-slate-100">
              {options.map((o) => {
                const pr = ops.ix.provider[o.provider_id]; const p = priceInfo(o)
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{pr?.name} · {o.vehicle_class}</p><p className="text-xs text-muted">{o.passenger_capacity} pax · {o.luggage_capacity} bags · {o.payment_arrangement}</p></div>
                    <Badge tone={p.tone}>{p.label}: {p.amount}</Badge>
                    {!o.available && <Badge>Hidden</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setEdit(o)} aria-label={`Edit ${pr?.name} ${o.vehicle_class}`}><Pencil className="size-4" /></Button>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      </div>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add transport option' : 'Edit transport option'} wide>
        {edit && <OptionForm key={edit.id ?? 'new'} initial={edit === 'new' ? null : edit} hotelId={hotel.id} providers={ops.transport_providers.filter((p) => p.status === 'active')} onClose={() => setEdit(null)} />}
      </Modal>
    </>
  )
}
