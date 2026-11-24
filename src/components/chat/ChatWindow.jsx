import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BadgeCheck, MoreVertical, Phone, SendHorizontal, ShieldCheck, X } from 'lucide-react'
import ChatMessage from './ChatMessage'

const SUGGESTIONS = {
  ARRIVAL_TIME: ['10:30', '14:30', '21:45'],
  ARRIVAL_DATE: ['28/11', '02/12'],
  INCIDENT_DESCRIPTION: ['A man said he was my driver, but the registration was different and he wanted cash.'],
  VERIFICATION: [],
}
const PLACEHOLDER = {
  ARRIVAL_TIME: 'Type a time, e.g. 14:30', ARRIVAL_DATE: 'Type a date, e.g. 28/11', NAME: 'Type your name', PHONE: '+44 7700 900123',
  INCIDENT_DESCRIPTION: 'Describe what happened…', VERIFICATION: 'Type the code the driver said…',
}

/** WhatsApp-style chat surface. Simulated: nothing is sent through WhatsApp. */
export default function ChatWindow({ log, state, busy, onSend, onTap }) {
  const [text, setText] = useState('')
  const [sheet, setSheet] = useState(null)
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [log.length, busy])

  const lastBot = [...log].reverse().find((e) => e.from === 'bot' && !e.push)
  const submit = (e) => { e.preventDefault(); if (text.trim() && !busy) { onSend(text.trim()); setText('') } }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-chat">
      <header className="flex items-center gap-2 bg-deep px-3 py-2.5 text-white">
        <ArrowLeft className="size-5 text-white/70" aria-hidden />
        <span className="grid size-9 place-items-center rounded-full bg-teal"><ShieldCheck className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-semibold">Safe Arrival CPT <BadgeCheck className="size-4 shrink-0 text-teal" aria-label="Verified business account" /></p>
          <p className="text-[11px] text-white/70" aria-live="polite">{busy ? 'typing…' : 'Official business account'}</p>
        </div>
        <Phone className="size-5 text-white/40" aria-hidden />
        <MoreVertical className="size-5 text-white/40" aria-hidden />
      </header>

      <div className="chat-pattern flex-1 space-y-2 overflow-y-auto px-3 py-4" role="log" aria-live="polite" aria-label="Conversation with Safe Arrival CPT">
        <p className="mx-auto w-fit rounded-md bg-amber/20 px-2 py-1 text-center text-[11px] text-amber-ink shadow-sm">Simulated WhatsApp conversation. Nothing is sent to WhatsApp.</p>
        {log.map((e) => <ChatMessage key={e.id} entry={e} active={e === lastBot && !busy} onTap={onTap} onOpenList={setSheet} />)}
        {busy && (
          <div className="flex w-fit gap-1 rounded-lg rounded-tl-none bg-white px-3 py-3 shadow-sm" aria-label="Safe Arrival is typing">
            {[0, 1, 2].map((i) => <span key={i} className="typing-dot size-2 rounded-full bg-slate-400" />)}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {!busy && SUGGESTIONS[state]?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-black/5 bg-white/70 px-3 py-2">
          <span className="w-full text-[10px] font-medium uppercase tracking-wide text-slate-500">Demo suggestions</span>
          {SUGGESTIONS[state].map((s) => (
            <button key={s} onClick={() => onSend(s)} className="max-w-full truncate rounded-full border border-teal/40 bg-white px-3 py-1 text-xs font-medium text-teal-ink hover:bg-teal/10">{s}</button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2">
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoComplete="off"
          placeholder={PLACEHOLDER[state] ?? 'Message'} className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 text-sm text-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal/40" />
        <button type="submit" disabled={!text.trim() || busy} className="grid size-10 place-items-center rounded-full bg-teal text-white disabled:opacity-40" aria-label="Send message">
          <SendHorizontal className="size-5" />
        </button>
      </form>

      {sheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)}>
          <div className="max-h-[75%] overflow-y-auto rounded-t-2xl bg-white pb-3" role="dialog" aria-label={sheet.button} onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
              <p className="font-semibold">{sheet.button}</p>
              <button onClick={() => setSheet(null)} className="rounded-md p-1 hover:bg-slate-100" aria-label="Close"><X className="size-5" /></button>
            </div>
            <ul>
              {sheet.rows.map((row) => (
                <li key={row.id}>
                  <button onClick={() => { setSheet(null); onTap(row) }} className="w-full px-4 py-3 text-left hover:bg-slate-50">
                    <span className="block text-sm font-medium">{row.title}</span>
                    {row.description && <span className="block text-xs text-muted">{row.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
