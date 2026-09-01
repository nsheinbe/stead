// Cron: release dates held by abandoned checkouts.
//
// A pending_payment booking occupies the exclusion constraint, so without
// this an abandoned checkout would dead-lock those dates forever. TTL comes
// from app_config.pending_payment_ttl_minutes (default 30).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { errorResponse, jsonResponse } from '../_shared/http.ts'
import { expiryCutoff } from '../_shared/expire.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: ttlRow, error: ttlError } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'pending_payment_ttl_minutes')
    .single()

  if (ttlError || ttlRow === null) {
    return errorResponse('server_error', 'Could not read the expiry TTL.', 500)
  }

  let cutoff: string
  try {
    cutoff = expiryCutoff(Number(ttlRow.value)).toISOString()
  } catch {
    return errorResponse('server_error', 'Expiry TTL is invalid.', 500)
  }

  const { data: expired, error: updateError } = await admin
    .from('bookings')
    .update({ status: 'expired' })
    .eq('status', 'pending_payment')
    .lt('created_at', cutoff)
    .select('id')

  if (updateError) {
    return errorResponse('server_error', 'Could not expire bookings.', 500)
  }

  return jsonResponse({ expired: expired?.length ?? 0, cutoff })
})
