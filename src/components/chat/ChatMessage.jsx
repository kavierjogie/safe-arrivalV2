import { Fragment } from 'react'
import { CheckCheck, List } from 'lucide-react'
import { fmt } from '../../lib/labels'

// WhatsApp-style formatting: *bold* and clickable links.
function Rich({ text }) {
  const parts = text.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g)
  return parts.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-sky-700 underline">{p.replace(location.origin, location.host)}</a>
    return <Fragment key={i}>{p}</Fragment>
  })
}

/** One chat bubble. Interactive parts are enabled only on the latest bot message. */
export default function ChatMessage({ entry, active, onTap, onOpenList }) {
  const me = entry.from === 'user'
  const r = entry.reply
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[88%]">
        <div className={`relative rounded-lg px-2.5 pb-1.5 pt-2 text-[14px] leading-snug text-navy shadow-sm ${me ? 'rounded-tr-none bg-bubble-out' : 'rounded-tl-none bg-white'}`}>
          {entry.push && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-teal-ink">Notification</p>}
          <p className="whitespace-pre-line"><Rich text={r.text} /></p>
          <span className="float-right ml-3 mt-1 flex items-center gap-0.5 text-[10px] text-slate-500">
            {fmt(entry.at, 'HH:mm')}{me && <CheckCheck className="size-3.5 text-sky-500" aria-label="Read" />}
          </span>
          <span className="clear-both block" />
          {r.type === 'list' && (
            <button disabled={!active} onClick={() => onOpenList(r)} className="mt-1.5 flex w-full items-center justify-center gap-1.5 border-t border-slate-100 pt-2 text-sm font-medium text-sky-700 disabled:text-slate-400">
              <List className="size-4" aria-hidden />{r.button}
            </button>
          )}
        </div>
        {r.type === 'buttons' && (
          <div className="mt-1 grid gap-1" role="group" aria-label="Reply options">
            {r.buttons.map((b) => (
              <button key={b.id} disabled={!active} onClick={() => onTap(b)}
                className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-sky-700 shadow-sm hover:bg-slate-50 disabled:text-slate-400">
                {b.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
