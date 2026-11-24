// The only way the MCP server touches data: public.mcp_call on Supabase, called
// with the ANON key plus the shared MCP server secret (checked inside Postgres).
// No service-role key is used or needed.
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export function supabaseBackend({ url = process.env.SUPABASE_URL, anonKey = process.env.SUPABASE_ANON_KEY, secret = process.env.MCP_SERVER_SECRET } = {}) {
  if (!url || !anonKey || !secret) throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and MCP_SERVER_SECRET (see mcp-server/.env.example)')
  const db = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { 'x-mcp-secret': secret } } })
  return {
    secret,
    async call(tool, args, { client, clientName }) {
      const { data, error } = await db.rpc('mcp_call', { p_tool: tool, p_args: args, p_client: client, p_client_name: clientName })
      if (error) {
        console.error('mcp_call failed', tool, error.message)
        return { ok: false, code: 'error', error: 'SafeArrival is temporarily unavailable. In an emergency call 10111 (police) or 112 from a mobile.' }
      }
      return data
    },
  }
}

/** Rate-limit key: a salted hash of the caller's IP. The IP itself is never sent or stored. */
export const clientKey = (ip, secret) => createHash('sha256').update(`${secret}|${ip ?? 'unknown'}`).digest('hex').slice(0, 32)
