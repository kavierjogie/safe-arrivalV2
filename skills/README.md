# SafeArrival Agent Skill

[`safearrival-travel-safety/`](safearrival-travel-safety/SKILL.md) follows the open [Agent Skills](https://agentskills.io)
format. It teaches an agent when to call each SafeArrival MCP tool and how to explain the results:
- verification status
- emergencies first
- driver-says-the-code-first
- no safety verdicts
- privacy

It **complements** the MCP server and does nothing without it. Connect the server first
([Claude](../docs/integrations/connect-claude.md), [ChatGPT](../docs/integrations/connect-chatgpt.md), [others](../docs/integrations/mcp-clients.md)).

## Install
**Claude (web and desktop):** needs code execution on (Settings → Capabilities).
1. Zip the folder so the zip contains `safearrival-travel-safety/SKILL.md`:
   ```powershell
   tar -a -cf safearrival-travel-safety.zip -C skills safearrival-travel-safety
   ```
   This works the same in Windows 10+ PowerShell, macOS and Linux. Avoid `Compress-Archive` in Windows PowerShell 5.1:
   it writes backslash paths that some zip readers reject.
2. **Customize → Skills** (`claude.ai/customize/skills`) → **+ → Create skill → Upload a skill** → choose the zip.

On Enterprise plans an owner must first enable *Code execution* and *Skills* (Organization settings → Plugins & skills).

**Claude Code:** copy the folder to `~/.claude/skills/` (all projects) or `.claude/skills/` (this project). Skills
enabled on claude.ai also sync to Claude Code when you're signed in with the same account.

**Other agents that read Agent Skills:** place the folder wherever that agent loads skills from. The skill uses only
the MCP tools; it has no scripts.

**ChatGPT:** doesn't load skills. The same rules ship inside the MCP server's instructions and tool descriptions.

## Files
- `SKILL.md`: rules and priorities (under 500 lines, per the spec)
- `references/tools.md`: intent → tool → inputs → which fields to read
- `references/scenarios.md`: worked conversations (airport safety, driver verification, impostor at arrivals)
