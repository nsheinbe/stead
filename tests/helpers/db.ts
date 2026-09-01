import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { SERVICE_ROLE_KEY, SUPABASE_URL } from './env'

export type Admin = SupabaseClient<Database>

export function adminClient(): Admin {
  return createClient<Database>(SUPABASE_URL as string, SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface Fixture {
  userId: string
  listingId: string
}

let counter = 0

/** Creates a throwaway host + active listing. Caller must destroyFixture(). */
export async function createFixture(admin: Admin): Promise<Fixture> {
  counter += 1
  const email = `vitest-${Date.now()}-${counter}@example.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`could not create test user: ${error?.message}`)

  const { data: listing, error: listingError } = await admin
    .from('listings')
    .insert({
      host_id: data.user.id,
      title: 'Vitest Cabin',
      type: 'entire_home',
      city: 'Bend',
      country: 'US',
      timezone: 'America/Los_Angeles',
      nightly_rate_cents: 20_000,
      deposit_cents: 30_000,
      max_guests: 4,
      status: 'active',
    })
    .select('id')
    .single()
  if (listingError || !listing) {
    throw new Error(`could not create test listing: ${listingError?.message}`)
  }

  return { userId: data.user.id, listingId: listing.id }
}

export async function destroyFixture(admin: Admin, fixture: Fixture): Promise<void> {
  await admin.from('bookings').delete().eq('listing_id', fixture.listingId)
  await admin.from('listings').delete().eq('id', fixture.listingId)
  await admin.auth.admin.deleteUser(fixture.userId)
}

export interface BookingSpec {
  checkIn: string
  checkOut: string
  status?: Database['public']['Enums']['booking_status']
  createdAt?: string
}

const NIGHTLY = 20_000
const FEE_BPS = 200

export async function insertBooking(admin: Admin, fixture: Fixture, spec: BookingSpec) {
  const nights = Math.round(
    (Date.parse(`${spec.checkOut}T00:00:00Z`) - Date.parse(`${spec.checkIn}T00:00:00Z`)) /
      86_400_000,
  )
  const subtotal = NIGHTLY * nights
  const fee = Math.round((subtotal * FEE_BPS) / 10_000)

  return admin
    .from('bookings')
    .insert({
      listing_id: fixture.listingId,
      guest_id: fixture.userId,
      check_in: spec.checkIn,
      check_out: spec.checkOut,
      guests: 2,
      nights,
      nightly_rate_cents: NIGHTLY,
      stay_subtotal_cents: subtotal,
      network_fee_cents: fee,
      guest_total_cents: subtotal + fee,
      deposit_cents: 30_000,
      cancellation_policy: 'moderate',
      status: spec.status ?? 'confirmed',
      ...(spec.createdAt ? { created_at: spec.createdAt } : {}),
    })
    .select('id, status')
    .single()
}
