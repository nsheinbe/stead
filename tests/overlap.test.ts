import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDbAccess } from './helpers/env'
import {
  adminClient,
  createFixture,
  destroyFixture,
  insertBooking,
  type Admin,
  type Fixture,
} from './helpers/db'

const EXCLUSION_VIOLATION = '23P01'

// Proves availability is enforced by the database, not by application code.
// Requires SUPABASE_SERVICE_ROLE_KEY: RLS denies booking writes to every
// client role by design, so there is no weaker credential that can do this.
describe.skipIf(!hasDbAccess)('booking availability constraint', () => {
  let admin: Admin
  let fixture: Fixture

  beforeAll(async () => {
    admin = adminClient()
    fixture = await createFixture(admin)
  })

  afterAll(async () => {
    if (fixture) await destroyFixture(admin, fixture)
  })

  it('rejects a second booking overlapping a confirmed one', async () => {
    const first = await insertBooking(admin, fixture, {
      checkIn: '2027-03-01',
      checkOut: '2027-03-05',
    })
    expect(first.error).toBeNull()

    const overlapping = await insertBooking(admin, fixture, {
      checkIn: '2027-03-03',
      checkOut: '2027-03-07',
    })
    expect(overlapping.error).not.toBeNull()
    expect(overlapping.error?.code).toBe(EXCLUSION_VIOLATION)
  })

  it('allows a back-to-back booking, because the range is half-open', async () => {
    // Checkout day is not a night, so 03-05 -> 03-08 must not collide with
    // the 03-01 -> 03-05 stay above.
    const backToBack = await insertBooking(admin, fixture, {
      checkIn: '2027-03-05',
      checkOut: '2027-03-08',
    })
    expect(backToBack.error).toBeNull()
  })

  it('ignores bookings whose status does not hold dates', async () => {
    // The constraint is partial: expired and canceled rows must not block.
    const expired = await insertBooking(admin, fixture, {
      checkIn: '2027-03-02',
      checkOut: '2027-03-04',
      status: 'expired',
    })
    expect(expired.error).toBeNull()

    const canceled = await insertBooking(admin, fixture, {
      checkIn: '2027-03-02',
      checkOut: '2027-03-04',
      status: 'canceled_by_guest',
    })
    expect(canceled.error).toBeNull()
  })

  it('blocks against a pending_payment hold too', async () => {
    const pending = await insertBooking(admin, fixture, {
      checkIn: '2027-04-01',
      checkOut: '2027-04-04',
      status: 'pending_payment',
    })
    expect(pending.error).toBeNull()

    const contender = await insertBooking(admin, fixture, {
      checkIn: '2027-04-02',
      checkOut: '2027-04-06',
    })
    expect(contender.error?.code).toBe(EXCLUSION_VIOLATION)
  })
})
