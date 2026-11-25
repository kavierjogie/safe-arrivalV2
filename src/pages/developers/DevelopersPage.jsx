import { useEffect, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { ArrowRight, Check, Copy, ExternalLink, Lock, Pencil, Play, ShieldCheck, Terminal } from 'lucide-react'
import { PublicPage } from '../../components/layout/Layouts'
import { Badge } from '../../components/common/StatusBadges'
import { Button, Spinner, textareaCls } from '../../components/common/ui'
import { MCP_URL, REPO_URL, callTool, listTools } from '../../lib/mcp'

const SECTIONS = [
  ['', 'Overview'], ['mcp', 'How it works'], ['tools', 'Tool reference'], ['installation', 'Install & connect'],
  ['api', 'API & live examples'], ['skill', 'Agent Skill'],
]

// ---------------------------------------------------------------- building blocks
function Code({ children, label }) {
  const [done, setDone] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(children); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ } }
  return (
    <div className="group relative my-3">
      {label && <p className="mb-1 text-xs font-medium text-muted">{label}</p>}
      <pre className="overflow-x-auto rounded-lg bg-navy p-3 pr-12 text-[13px] leading-relaxed text-slate-100"><code>{children}</code></pre>
      <button onClick={copy} className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-white/80 hover:bg-white/20" style={label ? { top: '1.85rem' } : undefined}
        aria-label={done ? 'Copied' : 'Copy to clipboard'}>{done ? <Check className="size-4" /> : <Copy className="size-4" />}</button>
    </div>
  )
}
const H2 = ({ children, id }) => <h2 id={id} className="mt-10 scroll-mt-24 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>
const P = ({ children }) => <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{children}</p>
const Ext = ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-teal-ink underline-offset-2 hover:underline">{children}<ExternalLink className="size-3" aria-hidden /></a>
const Note = ({ children }) => <div className="mt-4 rounded-lg border-l-4 border-amber bg-amber/10 p-3 text-sm text-amber-ink">{children}</div>

function useTools() {
  const [state, setState] = useState({ tools: null, error: null })
  useEffect(() => {
    let live = true
    listTools().then((tools) => live && setState({ tools, error: null })).catch((e) => live && setState({ tools: null, error: e.message }))
    return () => { live = false }
  }, [])
  return state
}

const kind = (a = {}) => (a.readOnlyHint ? ['green', Lock, 'Read-only'] : a.destructiveHint ? ['red', Pencil, 'Writes · can delete'] : ['amber', Pencil, 'Writes data'])
const typeOf = (s) => (s.enum ? s.enum.map((v) => `"${v}"`).join(' | ') : s.type === 'array' ? `${s.items?.enum ? `(${s.items.enum.join(' | ')})` : s.items?.type}[]` : s.type)
function constraints(s) {
  const c = []
  if (s.minimum != null || s.maximum != null) c.push(`${s.minimum ?? '…'}–${s.maximum ?? '…'}`)
  if (s.minLength != null || s.maxLength != null) c.push(`length ${s.minLength ?? 0}–${s.maxLength ?? '…'}`)
  if (s.default !== undefined) c.push(`default ${JSON.stringify(s.default)}`)
  if (s.pattern) c.push(`pattern ${s.pattern}`)
  return c.join(' · ')
}

// ---------------------------------------------------------------- sections
function Overview() {
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wider text-teal-ink">SafeArrival for developers</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Tourist transport-safety tools for any AI assistant</h1>
      <P>SafeArrival MCP is a public <Ext href="https://modelcontextprotocol.io">Model Context Protocol</Ext> server. ChatGPT, Claude, Cursor, VS Code or your own app can use it to look up transport-safety reports, verify a SafeArrival driver or transport partner, find pickup guidance and South African emergency numbers, file a report, or subscribe to alerts for an area.</P>
      <Code label="Endpoint (Streamable HTTP, no sign-in)">{MCP_URL}</Code>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[['Honest by design', 'Every result is labelled verified, unverified or advisory, with timestamps, location precision and limitations. There are no safety scores, and no reports never means “safe”.'],
          ['Private by default', 'Raw traveller descriptions never leave the database, locations are approximate, and booking codes are never returned. Calls are logged without arguments or IPs.'],
          ['Built to be reused', 'Fifteen tools on an open protocol, plus an Agent Skill that teaches agents how to explain the results. Bring your own assistant.']].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-slate-200 bg-white p-4"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-slate-600">{d}</p></div>
        ))}
      </div>
      <H2>Start here</H2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {[['installation', 'Connect ChatGPT, Claude or your IDE', 'Click paths, plan requirements, configs'], ['tools', 'Browse the 15 tools', 'Live from the server: inputs, limits, annotations'],
          ['api', 'Call it from code', 'curl, JavaScript SDK, try read-only tools live'], ['skill', 'Install the Agent Skill', 'Teach your agent the safety rules']].map(([to, t, d]) => (
          <Link key={to} to={`/developers/${to}`} className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-teal">
            <span><span className="font-medium">{t}</span><span className="block text-sm text-muted">{d}</span></span><ArrowRight className="size-4 text-muted group-hover:text-teal-ink" aria-hidden />
          </Link>
        ))}
      </div>
      <H2>Supported clients</H2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-muted"><tr><th className="px-3 py-2">Client</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Notes</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {[['Claude (web, desktop)', 'Tested', 'All plans can add a custom connector; Free plans are limited to one.'],
              ['ChatGPT', 'Tested', 'Business and Enterprise/Edu on the web (full MCP); Pro is read-only. Not available on Free or Plus.'],
              ['Claude Code', 'Supported', 'claude mcp add --transport http'], ['Cursor, VS Code', 'Supported', 'Remote MCP over Streamable HTTP'],
              ['MCP Inspector, SDKs', 'Tested', 'Protocol 2026-07-28, with a stateless fallback for 2025-era clients']].map(([c, s, n]) => (
              <tr key={c}><td className="px-3 py-2 font-medium">{c}</td><td className="px-3 py-2"><Badge tone={s === 'Tested' ? 'green' : 'teal'}>{s}</Badge></td><td className="px-3 py-2 text-slate-600">{n}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>Coverage today is Cape Town. This deployment holds <strong>fictional demo data</strong>, and every response says so in <code>data_notice</code>.</Note>
      <H2>Contribute</H2>
      <P>The server, database functions, skill and these docs are in <Ext href={REPO_URL}>the GitHub repository</Ext>. Issues and pull requests are welcome, especially new coverage areas, data partnerships with official sources, and client guides.</P>
    </>
  )
}

function HowItWorks() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">How SafeArrival MCP works</h1>
      <P>MCP is an open protocol that lets AI assistants call external tools. SafeArrival exposes its safety data as tools, so your assistant can use them instead of guessing.</P>
      <div className="mt-5 grid gap-2 text-sm sm:grid-cols-4">
        {[['AI assistant', 'ChatGPT, Claude, IDE or your app'], ['MCP server', 'Validates input, sends the call over HTTPS'], ['mcp_call (Postgres)', 'Checks secret, rate limits, dataset switches, logs the call'], ['SafeArrival data', 'Reports, advisories, partners, pickup points']].map(([t, d], i) => (
          <div key={t} className="relative rounded-xl border border-slate-200 bg-white p-3"><p className="font-mono text-xs text-teal-ink">{i + 1}</p><p className="font-semibold">{t}</p><p className="text-xs text-muted">{d}</p></div>
        ))}
      </div>
      <H2>What the data is, and is not</H2>
      <P>SafeArrival data is <strong>traveller reports about transport</strong>: extra-payment demands, impostor drivers, touting, intimidation and drivers who can’t be found. It is not crime statistics. Every item carries a <code>type</code>:</P>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">
        <li><code>safety_advisory</code>: published by the SafeArrival safety team.</li>
        <li><code>verified_incident</code>: reviewed and confirmed by the safety team, with a summary they wrote.</li>
        <li><code>unverified_report</code>: a traveller’s report, not yet confirmed. Only the category is published, never the text.</li>
      </ul>
      <P>Items also carry <code>reported_at</code>, <code>last_updated</code>, <code>review_status</code> (active, expired, under review, case closed), <code>is_historical</code>, location <code>precision</code> (pickup point or ~1 km) and <code>limitations</code>.</P>
      <H2>Alerts are monitored by the backend</H2>
      <P>Subscriptions are stored by SafeArrival. When the safety team verifies an incident or publishes an advisory, a database trigger matches active subscriptions by radius and category, and records exactly one alert per subscriber. The AI conversation doesn’t need to stay open, and nobody’s live location is tracked.</P>
      <H2>Security and privacy</H2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">
        <li>No service-role key. The server uses a public key plus a server secret that is checked inside the database.</li>
        <li>Inputs are validated twice: by schema in the server, and by type and range in SQL.</li>
        <li>Tool results contain no raw free text from reports, which shuts that route for prompt injection. The server’s instructions tell agents to treat results as data.</li>
        <li>Rate limits per caller (a salted IP hash): 60 reads per minute, and 3 submissions (reports plus subscriptions) per hour.</li>
        <li>The request log keeps the tool, outcome, duration, user agent and a ~10 km area, never arguments or IPs.</li>
        <li>POPIA-minded: consent is recorded for alerts, subscriptions expire within 30 days, and unsubscribing deletes the number and location.</li>
        <li>Booking tokens and verification codes are never returned. <code>verify_driver</code> answers match or mismatch only.</li>
      </ul>
    </>
  )
}

function ToolsRef() {
  const { tools, error } = useTools()
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Tool reference</h1>
      <P>Loaded live from the server’s <code>tools/list</code>, so it always matches what your assistant sees.</P>
      {error && <Note>Couldn’t reach the server: {error}</Note>}
      {!tools && !error && <Spinner label="Loading tools from the server…" />}
      <div className="mt-4 space-y-4">
        {tools?.map((t) => {
          const [tone, Icon, label] = kind(t.annotations)
          const props = Object.entries(t.inputSchema?.properties ?? {})
          const req = new Set(t.inputSchema?.required ?? [])
          return (
            <section key={t.name} id={t.name} className="scroll-mt-24 rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                <code className="text-[15px] font-semibold text-navy">{t.name}</code><Badge tone={tone} icon={Icon}>{label}</Badge>
                <span className="text-sm text-muted">{t.title}</span>
              </div>
              <p className="px-4 pt-3 text-sm leading-relaxed text-slate-700">{t.description}</p>
              <div className="overflow-x-auto p-4">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted"><tr><th className="py-1 pr-3">Parameter</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Constraints</th><th className="py-1">Description</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {props.map(([k, s]) => (
                      <tr key={k} className="align-top"><td className="py-1.5 pr-3 font-mono text-xs">{k}{req.has(k) && <span className="text-alert-ink" title="required"> *</span>}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-slate-600">{typeOf(s)}</td><td className="py-1.5 pr-3 text-xs text-slate-600">{constraints(s)}</td>
                        <td className="py-1.5 text-xs text-slate-700">{s.description}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

function Install() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Install & connect</h1>
      <P>The server is public and needs no sign-in. Paste the URL into your client.</P>
      <Code>{MCP_URL}</Code>
      <H2>Claude</H2>
      <P>Available on Free (one custom connector), Pro, Max, Ultra, Team and Enterprise. On Team and Enterprise, an owner adds it under Organization settings → Connectors.</P>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] text-slate-700">
        <li>Go to <strong>Customize → Connectors → + Add → Add custom connector</strong>.</li>
        <li>Name: <code>SafeArrival</code>. URL: the endpoint above. Authentication: <strong>No sign-in</strong>. Then <strong>Add</strong>.</li>
        <li>In a chat, open <strong>+ → Connectors</strong>, switch SafeArrival on, and ask: <em>“Is the area around Cape Town International Airport safe?”</em></li>
      </ol>
      <H2>ChatGPT</H2>
      <Note>Custom MCP servers need <strong>ChatGPT Business or Enterprise/Edu</strong> (full MCP) on the web, set up by an admin or an authorised member. <strong>Pro</strong> can use read-only tools. <strong>Free and Plus can’t add custom servers.</strong> Plans change often, so check OpenAI’s help article first.</Note>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[15px] text-slate-700">
        <li>Go to <strong>chatgpt.com/plugins → + → Add custom MCP server</strong>.</li>
        <li>Enter the endpoint above, including <code>/mcp</code>, with no authentication. Then <strong>Create as a plugin</strong> and check the 15 tools.</li>
        <li>In a new chat, type <strong>@SafeArrival</strong> and ask your question. @-mention it again for follow-ups.</li>
      </ol>
      <H2>Claude Code</H2>
      <Code>{`claude mcp add --transport http safearrival ${MCP_URL}`}</Code>
      <H2>Cursor</H2>
      <Code label="~/.cursor/mcp.json">{JSON.stringify({ mcpServers: { safearrival: { url: MCP_URL } } }, null, 2)}</Code>
      <H2>VS Code (Copilot agent mode)</H2>
      <Code label=".vscode/mcp.json">{JSON.stringify({ servers: { safearrival: { type: 'http', url: MCP_URL } } }, null, 2)}</Code>
      <H2>MCP Inspector</H2>
      <Code>npx @modelcontextprotocol/inspector</Code>
      <P>Choose Streamable HTTP, paste the endpoint, then Connect → Tools.</P>
      <H2>Self-hosting</H2>
      <P>Run your own copy with your own Supabase project: apply the migrations in <code>supabase/migrations</code>, then deploy <code>mcp-server/</code>. Instructions are in the <Ext href={`${REPO_URL}/tree/main/mcp-server`}>server README</Ext>.</P>
    </>
  )
}

const EXAMPLES = {
  check_area_safety: { latitude: -33.9697, longitude: 18.5968, radius_km: 3, location_name: 'Cape Town International Airport' },
  get_safety_alerts: { days: 14, include_unverified: false },
  check_route_safety: { origin_latitude: -33.9697, origin_longitude: 18.5968, destination_latitude: -33.915, destination_longitude: 18.385 },
  verify_transport_provider: { provider_name: 'Cape Town Trusted Shuttle' },
  find_emergency_services: { latitude: -33.92, longitude: 18.42 },
  get_pickup_guidance: { hotel: 'Saltwater Lodge' },
  get_travel_safety_advice: { destination: 'Cape Town', travel_context: 'airport_arrival' },
}

function TryIt() {
  const { tools } = useTools()
  const readOnly = (tools ?? []).filter((t) => t.annotations?.readOnlyHint && EXAMPLES[t.name])
  const [name, setName] = useState('check_area_safety')
  const [args, setArgs] = useState(JSON.stringify(EXAMPLES.check_area_safety, null, 2))
  const [out, setOut] = useState(null)
  const [busy, setBusy] = useState(false)
  const pick = (n) => { setName(n); setArgs(JSON.stringify(EXAMPLES[n], null, 2)); setOut(null) }
  const run = async () => {
    setBusy(true)
    try {
      const r = await callTool(name, JSON.parse(args))
      setOut(r.isError ? { error: r.content?.[0]?.text } : r.structuredContent)
    } catch (e) { setOut({ error: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Tool">
        {readOnly.map((t) => <button key={t.name} role="tab" aria-selected={name === t.name} onClick={() => pick(t.name)}
          className={`rounded-md px-2.5 py-1 font-mono text-xs ${name === t.name ? 'bg-navy text-white' : 'bg-slate-100 text-navy hover:bg-slate-200'}`}>{t.name}</button>)}
      </div>
      <label className="mt-3 block text-xs font-medium text-muted" htmlFor="try-args">Arguments (JSON)</label>
      <textarea id="try-args" className={`${textareaCls} mt-1 font-mono text-xs`} rows={6} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
      <Button className="mt-2" size="sm" onClick={run} disabled={busy}><Play className="size-4" aria-hidden />{busy ? 'Calling…' : `Call ${name}`}</Button>
      <p className="mt-2 text-xs text-muted">Only read-only tools run here. Calls count towards the same rate limits as any client.</p>
      {out && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-navy p-3 text-[12px] leading-relaxed text-slate-100">{JSON.stringify(out, null, 2).slice(0, 8000)}</pre>}
    </div>
  )
}

function Api() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">API & live examples</h1>
      <P>Any MCP client works. Without one, send JSON-RPC over Streamable HTTP. The server is stateless, so no session is needed.</P>
      <H2>Try it live</H2>
      <TryIt />
      <H2>curl</H2>
      <Code>{`curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'mcp-protocol-version: 2025-06-18' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_emergency_services","arguments":{}}}'`}</Code>
      <P>The reply is JSON-RPC, sometimes as a one-message <code>text/event-stream</code>. The tool’s data is in <code>result.structuredContent</code>, with the same JSON as text in <code>result.content[0].text</code>.</P>
      <H2>JavaScript (official SDK)</H2>
      <Code>{`import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const client = new Client({ name: 'my-app', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL('${MCP_URL}')))
const res = await client.callTool({
  name: 'check_area_safety',
  arguments: { latitude: -33.9697, longitude: 18.5968, radius_km: 3 },
})
console.log(res.structuredContent.summary)`}</Code>
      <H2>Response conventions</H2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">
        <li><code>limitations</code>: show these to users, especially that “no reports” does not mean safe.</li>
        <li><code>data_notice</code>: present on demo deployments, saying the data is fictional.</li>
        <li><code>coverage.covered</code>: false outside SafeArrival areas. Draw no conclusions there.</li>
        <li>Write tools (<code>report_safety_incident</code>, <code>subscribe_safety_alerts</code>) need an explicit <code>user_confirmed</code> / <code>consent</code> flag. Ask your user first.</li>
      </ul>
      <H2>Errors</H2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-muted"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Meaning</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {[['invalid', 'Bad or missing input. The message says what to fix (consent, ranges, coverage…).'], ['not_found', 'Unknown booking token or alert link.'],
              ['rate_limited', '60 calls/min or 3 submissions/hour exceeded for your caller. Wait and retry.'], ['disabled', 'The safety team has switched that dataset off for AI clients.'],
              ['error', 'Unexpected server problem. The message always includes emergency numbers.']].map(([c, m]) => (
              <tr key={c}><td className="px-3 py-2 font-mono text-xs">{c}</td><td className="px-3 py-2 text-slate-700">{m}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>Errors come back as a tool result with <code>isError: true</code> and the code in brackets at the end of the text.</P>
    </>
  )
}

function Skill() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Agent Skill</h1>
      <P>The <code>safearrival-travel-safety</code> skill follows the open <Ext href="https://agentskills.io">Agent Skills</Ext> format. It teaches agents when to call each tool and how to talk about the results:</P>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">
        <li>Emergency numbers come first.</li>
        <li>Never call an area safe or dangerous.</li>
        <li>Label verified, unverified and advisory items.</li>
        <li>The driver says the code first.</li>
        <li>Get consent before reporting or subscribing.</li>
        <li>Protect tokens and private data.</li>
      </ul>
      <P>It works alongside the MCP server and does nothing without it.</P>
      <H2>Install in Claude</H2>
      <P>Needs code execution (Settings → Capabilities). Get <Ext href={`${REPO_URL}/tree/main/skills/safearrival-travel-safety`}>the skill folder</Ext>, zip it, then go to <strong>Customize → Skills → + → Create skill → Upload a skill</strong>.</P>
      <Code label="From the repository root">tar -a -cf safearrival-travel-safety.zip -C skills safearrival-travel-safety</Code>
      <H2>Claude Code and other agents</H2>
      <P>Copy the folder to <code>~/.claude/skills/</code> or <code>.claude/skills/</code>, or wherever your agent loads Agent Skills from.</P>
      <Note>ChatGPT doesn’t load skills. The same rules travel with the server itself, in its MCP instructions and tool descriptions.</Note>
      <H2>What’s inside</H2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-slate-700">
        <li><code>SKILL.md</code>: priorities and rules, with good and bad answer examples.</li>
        <li><code>references/tools.md</code>: which tool to call for each kind of question, and the fields to read.</li>
        <li><code>references/scenarios.md</code>: airport safety, driver verification, an impostor at arrivals, alert subscriptions, and destinations outside coverage.</li>
      </ul>
    </>
  )
}

const PAGES = { '': Overview, mcp: HowItWorks, tools: ToolsRef, installation: Install, api: Api, skill: Skill }

export default function DevelopersPage() {
  const { section = '' } = useParams()
  const Page = PAGES[section] ?? Overview
  useEffect(() => { window.scrollTo(0, 0) }, [section])
  return (
    <PublicPage>
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <aside className="mb-6 lg:mb-0">
          <nav aria-label="Developer docs" className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col">
            <p className="mb-2 hidden items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-muted lg:flex"><Terminal className="size-3.5" aria-hidden />Developers</p>
            {SECTIONS.map(([to, label]) => (
              <NavLink key={to} to={`/developers${to ? `/${to}` : ''}`} end
                className={({ isActive }) => `shrink-0 rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-navy font-medium text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</NavLink>
            ))}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hidden items-center gap-1 px-3 pt-3 text-xs text-muted hover:text-navy lg:flex">GitHub<ExternalLink className="size-3" aria-hidden /></a>
            <p className="hidden items-center gap-1 px-3 pt-1 text-xs text-muted lg:flex"><ShieldCheck className="size-3" aria-hidden />Demo data · Cape Town</p>
          </nav>
        </aside>
        <article className="min-w-0 max-w-3xl pb-10"><Page /></article>
      </div>
    </PublicPage>
  )
}
