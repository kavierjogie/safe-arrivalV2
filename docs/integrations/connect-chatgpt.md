# Connect SafeArrival to ChatGPT

**Server URL:** `https://safearrival-mcp.vercel.app/mcp` · **Auth:** none · **Transport:** Streamable HTTP

## Read this first: not every ChatGPT account can do this
OpenAI limits custom MCP servers by plan:

| Plan | Custom MCP server |
|---|---|
| Free, Plus | **Not available** |
| Pro | Read/fetch tools only. SafeArrival's read tools may work; `verify_driver` and `report_safety_incident` will not |
| Business | Full MCP. Only **admins/owners** can create and publish |
| Enterprise / Edu | Full MCP. Admins/owners, or members granted *Create plugins with MCPs* through RBAC |

It is available on **ChatGPT web only**, not the mobile apps. OpenAI states there are no geographic restrictions for
connecting. Plans and menus change often, so check OpenAI's help article
*"Connecting custom MCP servers in ChatGPT"* before a demo.

## Add SafeArrival
1. Go to **chatgpt.com/plugins** → **+** → **Add custom MCP server**.
2. Name: `SafeArrival`. Description: *South African tourist transport-safety tools*.
3. Connection URL: `https://safearrival-mcp.vercel.app/mcp` (include `/mcp`). Authentication: **none**.
4. Read the risk warning → **I understand and want to continue** → **Create as a plugin**.
5. Check that the 15 tools are listed, then install.

On older workspace layouts the path is **Workspace settings → Apps → Create → Scan Tools → Create**. Drafts show a
**Dev** label until an admin publishes them.

## Use it in a chat
Start a new chat, type **@**, choose **SafeArrival**, and ask your question. App selection applies to one message only, so
@-mention SafeArrival again for follow-ups. ChatGPT asks you to confirm actions according to the app's permissions.
SafeArrival marks `report_safety_incident` and `verify_driver` as non-read-only, so expect a confirmation prompt.

After the server changes, open the plugin at chatgpt.com/plugins and choose **Refresh**. In admin-published workspace
apps, new actions are disabled until an admin enables them.

## ChatGPT has no skill import
ChatGPT doesn't load Agent Skills. SafeArrival's core rules travel with the server instead (MCP `instructions` and the
tool descriptions): emergency numbers first, no safety verdicts, label verification status, never echo codes or tokens.

## Publishing to the ChatGPT directory (not done)
A public listing needs OpenAI organisation identity verification, a privacy policy URL, test prompts and a review at
platform.openai.com/plugins. SafeArrival is **not submitted**. A safety service with fictional demo data should not be
listed publicly.
