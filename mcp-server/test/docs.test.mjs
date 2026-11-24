// Keeps the Agent Skill and integration docs in sync with the real tool list,
// and checks the skill against the Agent Skills spec limits.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { TOOLS } from '../src/server.js'

const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const names = TOOLS.map((t) => t.name)

// ---- SKILL.md frontmatter (agentskills.io/specification)
const skillDir = 'skills/safearrival-travel-safety/'
const skill = read(`${skillDir}SKILL.md`)
const fm = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1]
assert.ok(fm, 'SKILL.md starts with YAML frontmatter')
const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim()
const name = field('name')
assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'name: lowercase letters, digits, single hyphens')
assert.ok(name.length <= 64)
assert.equal(name, skillDir.split('/')[1], 'name matches folder')
const description = field('description')
assert.ok(description.length > 0 && description.length <= 1024, `description length ${description.length}`)
assert.ok((field('compatibility') ?? '').length <= 500)
assert.ok(skill.split('\n').length < 500, 'SKILL.md under 500 lines')
for (const [, ref] of skill.matchAll(/\]\((references\/[^)]+)\)/g)) read(skillDir + ref) // linked files exist

// ---- every tool is documented, and docs mention no tool that doesn't exist
const toolsRef = read(`${skillDir}references/tools.md`)
for (const n of names) assert.ok(toolsRef.includes(`\`${n}\``), `references/tools.md documents ${n}`)
const docs = [skill, toolsRef, read(`${skillDir}references/scenarios.md`), read('mcp-server/README.md'),
  ...readdirSync(new URL('docs/integrations/', root)).map((f) => read(`docs/integrations/${f}`))].join('\n')
const mentioned = new Set([...docs.matchAll(/`([a-z]+(?:_[a-z]+){1,3})`/g)].map((m) => m[1]))
const TOOLISH = /^(check|get|verify|report|find|subscribe|manage|unsubscribe)_/
const FIELDS = new Set(['manage_url', 'manage_token', 'get_alert_subscription', 'update_alert_subscription', 'unsubscribe_alerts']) // fields + web RPCs
for (const m of mentioned) if (TOOLISH.test(m) && !FIELDS.has(m)) assert.ok(names.includes(m), `docs mention unknown tool ${m}`)

console.log(`✓ skill + docs: spec limits ok, ${names.length} tools documented, no unknown tool names`)
