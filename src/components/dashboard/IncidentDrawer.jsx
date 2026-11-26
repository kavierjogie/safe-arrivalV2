import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpRight, Building2, Car, Eye, Landmark, Megaphone, MessageCircle, Phone, ShieldAlert, StickyNote } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { photoUrl, rpc } from '../../services/api'
import { Button, Field, Info, Modal, inputCls, textareaCls } from '../common/ui'
import { CategoryBadge, IncidentStatusBadge, PriorityBadge, UrgentBadge } from '../common/StatusBadges'
import Timeline from '../common/Timeline'
import { INCIDENT_STATUS, PRIORITY, fmt } from '../../lib/labels'

function Evidence({ items }) {
  const [urls, setUrls] = useState([])
  useEffect(() => {
    let live = true
    Promise.all(items.map((e) => photoUrl('incident-evidence', e.storage_path))).then((u) => live && setUrls(u))
    return () => { live = false }
  }, [items])
  if (!items.length) return null
  return (
    <section>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Photos (private, signed links)</p>
      <div className="flex flex-wrap gap-2">{urls.map((u, i) => u && <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Evidence photo ${i + 1}`} className="size-24 rounded-lg object-cover ring-1 ring-slate-200" /></a>)}</div>
    </section>
  )
}

const QUICK = {
  hotel_staff: [
    ['follow_up', 'Acknowledge', Eye, 'Thank you for reporting this. Hotel staff have received your report and will contact you shortly.'],
    ['provider_notified', 'Notify provider', Car, 'We have contacted the transport provider about your trip.'],
    ['escalated', 'Escalate to provider safety team', ArrowUpRight, 'Your report has been escalated to the transport provider’s safety team.'],
    ['referred_authorities', 'Refer to authorities', Landmark, 'We recommend reporting this to SAPS (10111 or the nearest station). If you open a case, share the case number with us and we will add it to your report.'],
    ['resolved', 'Mark resolved', null, 'We believe this has been resolved. Reply on WhatsApp if anything is still wrong.'],
  ],
  provider_staff: [
    ['follow_up', 'Acknowledge', Eye, 'The transport provider has received your report and is looking into the trip.'],
    ['escalated', 'Escalate internally', ArrowUpRight, 'The provider’s safety team is reviewing the trip and the driver involved.'],
  ],
}
QUICK.admin = [['in_progress', 'Start working', Eye, 'The SafeArrival safety team is working on your report.'], ...QUICK.hotel_staff,
  ['awaiting_partner', 'Waiting on partner', Building2, 'We have asked the hotel or transport provider involved to respond.'],
  ['unable_to_contact', 'Unable to contact', null, 'We tried to reach you about your report. Please reply here on WhatsApp so we can continue.'],
  ['closed', 'Close report', null, 'This report has been closed by the Safe Arrival safety team.']]

/** Safety team only: priority, information requests and escalation with a recorded destination. */
function CasePanel({ incident: i, run }) {
  const [priority, setPriority] = useState(i.priority)
  const [reason, setReason] = useState('')
  const [question, setQuestion] = useState('')
  const [esc, setEsc] = useState({ to: '', msg: 'Your report has been escalated for further action.' })
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-3">
      <p className="text-sm font-semibold">Case management</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => rpc('set_incident_priority', { p_incident: i.id, p_priority: priority, p_reason: reason }), 'Priority updated'); setReason('') }}>
        <Field label="Priority"><select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)}>{Object.entries(PRIORITY).map(([k, [l, d]]) => <option key={k} value={k} title={d}>{l}</option>)}</select></Field>
        <Field label="Reason (internal)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} /></Field>
        <Button type="submit" size="sm" variant="outline" disabled={priority === i.priority}>Change priority</Button>
      </form>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => rpc('update_incident', { p_incident: i.id, p_status: 'awaiting_visitor', p_message: question, p_public: true }), 'Question sent to the visitor'); setQuestion('') }}>
        <Field label="Request more information from the visitor"><input className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What time did this happen?" required minLength={3} maxLength={2000} /></Field>
        <Button type="submit" size="sm" variant="outline"><MessageCircle className="size-4" aria-hidden />Ask visitor</Button>
      </form>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => rpc('escalate_incident', { p_incident: i.id, p_to: esc.to, p_message: esc.msg }), 'Escalated') }}>
        <Field label="Escalate to (internal)"><input className={inputCls} value={esc.to} onChange={(e) => setEsc((x) => ({ ...x, to: e.target.value }))} placeholder="e.g. SAPS Table Bay, provider safety desk" required minLength={2} maxLength={120} /></Field>
        <Field label="Message to visitor"><input className={inputCls} value={esc.msg} onChange={(e) => setEsc((x) => ({ ...x, msg: e.target.value }))} required minLength={3} maxLength={2000} /></Field>
        <Button type="submit" size="sm" variant="danger"><ArrowUpRight className="size-4" aria-hidden />Escalate</Button>
      </form>
      <p className="text-xs text-muted">Resolve or close with the quick actions above; that message is stored as the resolution. Never close a case only because the visitor stopped replying: use “Unable to contact”.</p>
    </div>
  )
}

const VERIFICATION = {
  unverified: 'Unverified: shown to AI assistants only as an unconfirmed traveller report, without its text',
  verified: 'Verified incident: published with your summary',
  official_advisory: 'SafeArrival advisory: published with your summary',
  rejected: 'Rejected: hidden from AI assistants and alerts',
}

/** Safety team only: decide what the public (MCP tools, alert subscribers) may see about this report. */
function PublishPanel({ incident: i, run }) {
  const [summary, setSummary] = useState(i.public_summary ?? '')
  const [days, setDays] = useState(30)
  const publish = (status) => run(() => rpc('set_incident_verification', { p_incident: i.id, p_status: status, p_summary: summary, p_public_days: Number(days) }),
    status === 'verified' || status === 'official_advisory' ? 'Published. Alert subscribers nearby are being notified.' : 'Saved')
  return (
    <div className="space-y-2 rounded-xl border border-teal/30 bg-teal/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Megaphone className="size-4" aria-hidden />Public safety intelligence</p>
      <p className="text-xs text-muted">Now: <strong>{VERIFICATION[i.verification_status] ?? i.verification_status}</strong>.
        Publishing makes the summary below visible to AI assistants and alerts subscribers whose area includes this location. The tourist’s own words are never published.</p>
      <Field label="Public summary (no names, plates of private people, or exact addresses)">
        <textarea className={textareaCls} rows={2} maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Travellers at the International Arrivals pickup area were asked for an unexpected cash fee." />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Public for (days)"><input className={inputCls} type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Button size="sm" variant="safe" disabled={summary.trim().length < 10} onClick={() => publish('verified')}>Publish as verified</Button>
        <Button size="sm" variant="outline" disabled={summary.trim().length < 10} onClick={() => publish('official_advisory')}>Publish as advisory</Button>
        {i.verification_status !== 'unverified' && <Button size="sm" variant="ghost" onClick={() => publish('unverified')}>Unpublish</Button>}
        <Button size="sm" variant="ghost" onClick={() => publish('rejected')}>Reject</Button>
      </div>
    </div>
  )
}

/** Incident detail for hotel, provider and admin staff. */
export default function IncidentDrawer({ ops, incidentId, onClose, onOpenBooking }) {
  const { role } = useApp()
  const i = ops.incidents.find((x) => x.id === incidentId)
  const [status, setStatus] = useState('')
  const [msg, setMsg] = useState('')
  const [pub, setPub] = useState(true)
  const [police, setPolice] = useState({ case: '', station: '' })
  if (!i) return null

  const updates = ops.incident_updates.filter((u) => u.incident_id === i.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const evidence = ops.incident_evidence.filter((e) => e.incident_id === i.id)
  const booking = ops.ix.booking[i.booking_id]
  const tourist = ops.ix.tourist[i.tourist_id]
  const hotel = ops.ix.hotel[i.hotel_id]
  const provider = ops.ix.provider[i.provider_id]
  const point = ops.ix.point[i.pickup_point_id]
  const admins = ops.profiles.filter((p) => p.role === 'admin')

  const run = async (fn, ok) => { try { await fn(); toast.success(ok) } catch (e) { toast.error(e.message) } }
  const update = (s, m, p = true) => run(() => rpc('update_incident', { p_incident: i.id, p_status: s || null, p_message: m, p_public: p }), p ? 'Update saved. The tourist was notified.' : 'Internal note saved')

  return (
    <Modal open onClose={onClose} title={`Incident ${i.reference}`} drawer>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2"><IncidentStatusBadge status={i.status} />{i.priority && <PriorityBadge priority={i.priority} />}<CategoryBadge category={i.category} />{i.needs_immediate_help && <UrgentBadge />}</div>
        <p className="text-xs text-muted">Unverified report from a tourist. Treat it as an allegation until investigated.</p>
        {i.description && <blockquote className="rounded-xl bg-slate-50 p-3 text-sm italic">“{i.description}”</blockquote>}
        <dl className="grid grid-cols-2 gap-4">
          <Info label="Reported">{fmt(i.created_at)}</Info>
          <Info label="Booking">{booking ? <button className="font-mono text-teal-ink underline" onClick={() => onOpenBooking?.(booking.id)}>{booking.reference}</button> : 'No booking'}</Info>
          <Info label="Location" className="col-span-2">{point?.name}{i.location_text ? ` · ${i.location_text}` : ''}</Info>
          <Info label="Tourist">{tourist?.full_name}</Info>
          <Info label="Hotel">{hotel?.name}</Info>
          <Info label="Provider">{provider?.name}</Info>
          <Info label="Police reference">{i.police_case_number ? `${i.police_case_number}${i.police_station ? ` · ${i.police_station}` : ''}` : 'None recorded'}</Info>
          {role === 'admin' && <Info label="Case owner">{ops.ix.profile[i.handler_id]?.full_name ?? 'Unassigned'}</Info>}
          {role === 'admin' && <Info label="Priority">{PRIORITY[i.priority]?.[0] ?? '—'}{i.priority_source === 'admin' ? ' (set by safety team)' : ' (suggested)'}</Info>}
          <Info label="Visitor safe now">{i.visitor_safe == null ? 'Not answered' : i.visitor_safe ? 'Yes' : 'No, needs help'}</Info>
          {role === 'admin' && <Info label="Reported via">{i.source === 'ai_assistant_report' ? 'AI assistant (MCP)' : i.contact_whatsapp ? 'WhatsApp' : 'Web or booking'}</Info>}
          {i.escalated_to && <Info label="Escalated to">{i.escalated_to}</Info>}
          {i.resolution && <Info label="Resolution" className="col-span-2">{i.resolution}</Info>}
        </dl>

        <div className="flex flex-wrap gap-2">
          {(tourist || (role === 'admin' && i.contact_whatsapp)) && <Button as="a" href={`https://wa.me/${(tourist?.whatsapp ?? i.contact_whatsapp).slice(1)}`} target="_blank" rel="noreferrer" variant="outline" size="sm"><MessageCircle className="size-4" aria-hidden />Contact visitor</Button>}
          {provider?.contact_phone && <Button as="a" href={`tel:${provider.contact_phone.replace(/\s/g, '')}`} variant="outline" size="sm"><Car className="size-4" aria-hidden />Call provider</Button>}
          {hotel?.phone && role !== 'hotel_staff' && <Button as="a" href={`tel:${hotel.phone.replace(/\s/g, '')}`} variant="outline" size="sm"><Building2 className="size-4" aria-hidden />Call hotel</Button>}
          {provider?.safety_contact && <span className="inline-flex items-center gap-1 text-xs text-muted"><Phone className="size-3.5" aria-hidden />Safety: {provider.safety_contact}</span>}
        </div>

        <Evidence items={evidence} />

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</p>
          <Timeline updates={updates} explain={false} />
        </section>

        <section className="space-y-3 border-t border-slate-200 pt-4" aria-label="Actions">
          <p className="text-sm font-semibold">Quick actions</p>
          <div className="flex flex-wrap gap-2">
            {(QUICK[role] ?? []).map(([s, label, Icon, m]) => (
              <Button key={s} size="sm" variant={s === 'escalated' ? 'danger' : s === 'resolved' || s === 'closed' ? 'safe' : 'outline'} disabled={i.status === s} onClick={() => update(s, m)}>
                {Icon && <Icon className="size-4" aria-hidden />}{label}
              </Button>
            ))}
          </div>

          <form className="space-y-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); update(status, msg, pub); setMsg('') }}>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><StickyNote className="size-4" aria-hidden />Add an update or internal note</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Change status (optional)"><select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Keep: {INCIDENT_STATUS[i.status][0]}</option>
                {Object.entries(INCIDENT_STATUS).filter(([k]) => role === 'admin' || !['closed', 'triage', 'assigned', 'unable_to_contact'].includes(k)).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
              </select></Field>
              <Field label="Visibility"><select className={inputCls} value={pub ? 'public' : 'internal'} onChange={(e) => setPub(e.target.value === 'public')}>
                <option value="public">Share with tourist (WhatsApp)</option><option value="internal">Internal note only</option></select></Field>
            </div>
            <Field label="Message"><textarea className={textareaCls} rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} required minLength={3} maxLength={2000} /></Field>
            <Button type="submit" size="sm" variant="dark">Save update</Button>
          </form>

          {role !== 'provider_staff' && (
            <form className="space-y-2 rounded-xl border border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); run(() => rpc('set_police_reference', { p_incident: i.id, p_case: police.case, p_station: police.station }), 'Police reference recorded') }}>
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Landmark className="size-4" aria-hidden />Record an official SAPS case number</p>
              <p className="text-xs text-muted">Only a number the tourist received from SAPS. This platform never issues police case numbers.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={inputCls} placeholder="e.g. CAS 123/11/2026" value={police.case} onChange={(e) => setPolice((p) => ({ ...p, case: e.target.value }))} required maxLength={40} aria-label="Case number" />
                <input className={inputCls} placeholder="Police station (optional)" value={police.station} onChange={(e) => setPolice((p) => ({ ...p, station: e.target.value }))} maxLength={80} aria-label="Police station" />
              </div>
              <Button type="submit" size="sm" variant="outline">Save reference</Button>
            </form>
          )}

          {role === 'admin' && <CasePanel key={`case-${i.id}-${i.priority}`} incident={i} run={run} />}

          {role === 'admin' && <PublishPanel key={i.id} incident={i} run={run} />}

          {role === 'admin' && (
            <Field label={<span className="flex items-center gap-1.5"><ShieldAlert className="size-4" aria-hidden />Case owner</span>}>
              <select className={inputCls} value={i.handler_id ?? ''} onChange={(e) => run(() => rpc('assign_incident_handler', { p_incident: i.id, p_handler: e.target.value || null }), 'Handler updated')}>
                <option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </Field>
          )}
        </section>
      </div>
    </Modal>
  )
}
