// Vercel Function (Node.js runtime, Web-standard signature) serving POST /mcp.
import { supabaseBackend, clientKey } from '../src/backend.js'
import { createHandler } from '../src/server.js'

const backend = supabaseBackend()
const handle = createHandler(backend, (req) => clientKey(req?.headers.get('x-forwarded-for')?.split(',')[0].trim(), backend.secret))

export const GET = handle
export const POST = handle
export const DELETE = handle
export const OPTIONS = handle
