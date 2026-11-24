#!/usr/bin/env node
// Local stdio transport for desktop MCP clients (Claude Desktop, Cursor, Inspector).
// Logs go to stderr: stdout carries the protocol.
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { supabaseBackend, clientKey } from './backend.js'
import { buildServer } from './server.js'

const backend = supabaseBackend()
serveStdio(() => buildServer(backend, { client: clientKey('stdio', backend.secret), clientName: 'stdio' }))
