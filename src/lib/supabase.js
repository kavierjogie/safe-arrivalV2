import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** null when env vars are missing → the app runs its in-browser demo database. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null
export const isSupabaseConfigured = Boolean(supabase)

/** WhatsApp Business number (digits only) — when set, QR codes open real WhatsApp. */
export const whatsappNumber = (import.meta.env.VITE_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')
export const WHATSAPP_BUSINESS_NAME = 'Safe Arrival CPT'
