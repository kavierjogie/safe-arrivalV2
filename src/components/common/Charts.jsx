import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const axis = { fontSize: 11, fill: '#64748B' }
const tip = { contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 } }

/** Horizontal bars — readable labels, one series. `data`: [{ name, value, color? }]. */
export function HBarChart({ data, height = 220, label = 'Count' }) {
  return (
    <div style={{ height }} role="img" aria-label={`${label}: ${data.map((d) => `${d.name} ${d.value}`).join(', ')}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#eef2f6" />
          <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={axis} axisLine={false} tickLine={false} />
          <Tooltip {...tip} cursor={{ fill: '#f4f7fa' }} formatter={(v) => [v, label]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14} label={{ position: 'right', fontSize: 11, fill: '#10243A' }}>
            {data.map((d) => <Cell key={d.name} fill={d.color ?? '#13A89E'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TrendChart({ data, height = 220, label = 'Reports' }) {
  return (
    <div style={{ height }} role="img" aria-label={`${label} per week: ${data.map((d) => `${d.name} ${d.value}`).join(', ')}`}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#13A89E" stopOpacity={0.3} /><stop offset="100%" stopColor="#13A89E" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eef2f6" />
          <XAxis dataKey="name" tick={axis} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
          <Tooltip {...tip} formatter={(v) => [v, label]} />
          <Area type="monotone" dataKey="value" stroke="#0b7a72" strokeWidth={2} fill="url(#trendFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Group rows into the last `weeks` calendar weeks (oldest → newest). */
export function weeklyCounts(rows, weeks = 8) {
  const now = Date.now()
  const week = 7 * 86400000
  return Array.from({ length: weeks }, (_, i) => {
    const k = weeks - 1 - i
    const n = rows.filter((r) => { const age = now - new Date(r.created_at); return age >= k * week && age < (k + 1) * week }).length
    return { name: k === 0 ? 'This wk' : `${k}w ago`, value: n }
  })
}
