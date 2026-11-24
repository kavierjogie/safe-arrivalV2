# Connect SafeArrival to Claude

**Server URL:** `https://safearrival-mcp.vercel.app/mcp` · **Auth:** none (public, rate-limited) · **Transport:** Streamable HTTP

## Who can add it
| Plan | Can add a custom connector? |
|---|---|
| Free | Yes, but only **one** custom connector |
| Pro, Max, Ultra | Yes |
| Team | Owners and Primary Owners add it for the organisation; members then enable it |
| Enterprise | Owners, Primary Owners, or a custom role with *Manage access to Libraries* |

Claude connects to the server from Anthropic's cloud, not your device. That's why SafeArrival runs on a public HTTPS URL
(port 443).

## Add the connector (Free, Pro, Max, Ultra)
1. Open **Customize → Connectors** (`claude.ai/customize/connectors`).
2. **+ Add → Add custom connector**.
3. Name: `SafeArrival`. URL: `https://safearrival-mcp.vercel.app/mcp`. **Continue**.
4. Authentication: **No sign-in**. **Continue → Add**.

On Team or Enterprise, an owner uses **Organization settings → Connectors → Add → Custom → Web** with the same values.

The connector works in Claude on the web and in the desktop app, because both go through your Claude account. Neither the URL
nor the auth setting can be edited later; remove and re-add the connector to change them.

## Use it in a chat
1. Click **+** in the message box → **Connectors**, and switch **SafeArrival** on for the conversation.
2. Ask, for example:
   - *Is the area around Cape Town International Airport safe right now?*
   - *How can I verify my shuttle driver when I land?*
   - *Is "Cape Town Trusted Shuttle" a legitimate company?*
   - *What emergency numbers should I save for South Africa?*
3. Claude asks before each tool call unless you choose **Always allow**. Recommended: allow the read-only tools, and keep
   **report_safety_incident** on *ask every time*. You can block individual tools in the connector's settings.

## Add the SafeArrival skill (recommended)
The skill teaches Claude how to interpret verification status, handle emergencies and avoid unsupported safety claims.
See [skills/README.md](../../skills/README.md). Skills need **code execution** enabled (Settings → Capabilities).

## Claude Code
```bash
claude mcp add --transport http safearrival https://safearrival-mcp.vercel.app/mcp
```
To install the skill, copy `skills/safearrival-travel-safety/` into `~/.claude/skills/` (personal) or `.claude/skills/`
(project).

## Troubleshooting
- **No tools appear:** check that the URL ends in `/mcp`, and open `https://safearrival-mcp.vercel.app/health`. It should
  show `"ok": true`.
- **"Rate limit reached":** the server allows 60 calls a minute per caller. Wait a minute.
- **Answers say "DEMO DATA":** this is correct. The hackathon deployment contains fictional records only.
