import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expiryCutoff } from '../supabase/functions/_shared/expire'
import { hasDbAccess } from './helpers/env'
import {
  adminClient,
  createFixture,
  destroyFixture,
  insertBooking,
  type Admin,
  type Fixture,
} from './helpers/db'

describe('expiryCutoff', () => {
  it('subtracts the TTL from now', () => {
    const now = new Date('2027-01-01T12:00:00Z')
    expect(expiryCutoff(30, now).toISOString()).toBe('2027-01-01T11:30:00.000Z')
  })

  it('rejects a non-positive or non-finite TTL', () => {
    expect(() => expiryCutoff(0)).toThrow()
    expect(() => expiryCutoff(-5)).toThrow()
    expect(() => expiryCutoff(Number.NaN)).toThrow()
  })
})

// The behaviour that actually matters: an abandoned checkout must release the
// dates it was holding, or the exclusion constraint dead-locks them forever.
describe.skipIf(!hasDbAccess)('expiring pending bookings frees the dates', () => {
  let admin: Admin
  let fixture: Fixture

  beforeAll(async () => {
    admin = adminClient()
    fixture = await createFixture(admin)
  })

  afterAll(async () => {
    if (fixture) await destroyFixture(admin, fixture)
  })

  it('flips stale pending rows to expired and reopens the dates', async () => {
    const stale = new Date(Date.now() - 60 * 60_000).toISOString() // 60 min ago
    const abandoned = await insertBooking(admin, fixture, {
      checkIn: '2027-06-01',
      checkOut: '2027-06-05',
      status: 'pending_payment',
      createdAt: stale,
    })
    expect(abandoned.error).toBeNull()

    // While it is still pending, the dates are held.
    const blocked = await insertBooking(admin, fixture, {
      checkIn: '2027-06-02',
      checkOut: '2027-06-04',
    })
    expect(blocked.error?.code).toBe('23P01')

    // Same query the cron function runs, over the shared cutoff rule.
    const cutoff = expiryCutoff(30).toISOString()
    const { data: expired, error } = await admin
      .from('bookings')
      .update({ status: 'expired' })
      .eq('status', 'pending_payment')
      .lt('created_at', cutoff)
      .select('id')

    expect(error).toBeNull()
    expect(expired?.length).toBeGreaterThanOrEqual(1)

    // Dates are free again.
    const rebooked = await insertBooking(admin, fixture, {
      checkIn: '2027-06-02',
      checkOut: '2027-06-04',
    })
    expect(rebooked.error).toBeNull()
  })

  it('leaves a fresh pending booking alone', async () => {
    const fresh = await insertBooking(admin, fixture, {
      checkIn: '2027-07-01',
      checkOut: '2027-07-03',
      status: 'pending_payment',
    })
    expect(fresh.error).toBeNull()

    const cutoff = expiryCutoff(30).toISOString()
    await admin
      .from('bookings')
      .update({ status: 'expired' })
      .eq('status', 'pending_payment')
      .lt('created_at', cutoff)
      .select('id')

    const { data: row } = await admin
      .from('bookings')
      .select('status')
      .eq('id', fresh.data!.id)
      .single()

    expect(row?.status).toBe('pending_payment')
  })
})
