import { CheckCircle2, Circle } from 'lucide-react'
import { INCIDENT_STATUS, fmt } from '../../lib/labels'

/** Incident progress timeline (tourist and staff views). */
export default function Timeline({ updates, explain = true }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
      {updates.map((u, i) => {
        const last = i === updates.length - 1
        return (
          <li key={`${u.created_at}-${i}`} className="relative">
            <span className={`absolute -left-[29px] top-0.5 grid size-5 place-items-center rounded-full ${last ? 'bg-teal text-white' : 'bg-white text-safe'}`}>
              {last ? <Circle className="size-2.5 fill-current" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />}
            </span>
            <p className="text-sm font-semibold">{u.status ? INCIDENT_STATUS[u.status]?.[0] : 'Update'}{u.visibility === 'internal' && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Internal</span>}</p>
            <p className="text-sm text-slate-700">{u.message}</p>
            {explain && last && u.status && <p className="mt-1 text-xs text-muted">{INCIDENT_STATUS[u.status]?.[1]}</p>}
            <p className="mt-0.5 text-[11px] text-muted">{fmt(u.created_at, 'd MMM, HH:mm')}{u.author_label && u.author_label !== 'System' ? ` · ${u.author_label}` : ''}</p>
          </li>
        )
      })}
    </ol>
  )
}
