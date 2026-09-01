import { describe, expect, it } from 'vitest'
import {
  nightsBetween,
  priceBooking,
} from '../supabase/functions/_shared/pricing'

const NETWORK_FEE_BPS = 200 // app_config default: 2%

describe('priceBooking', () => {
  it('matches the BUILD_PROMPT reference case', () => {
    // $200 x 5 nights -> guest pays $1,020, host receives $1,000,
    // $300 deposit held apart.
    const result = priceBooking({
      nightlyRateCents: 20_000,
      nights: 5,
      depositCents: 30_000,
      networkFeeBps: NETWORK_FEE_BPS,
    })

    expect(result.staySubtotalCents).toBe(100_000)
    expect(result.networkFeeCents).toBe(2_000)
    expect(result.guestTotalCents).toBe(102_000)
    expect(result.depositCents).toBe(30_000)
  })

  it('never folds the deposit into the guest total', () => {
    const withDeposit = priceBooking({
      nightlyRateCents: 15_000,
      nights: 3,
      depositCents: 50_000,
      networkFeeBps: NETWORK_FEE_BPS,
    })
    const withoutDeposit = priceBooking({
      nightlyRateCents: 15_000,
      nights: 3,
      depositCents: 0,
      networkFeeBps: NETWORK_FEE_BPS,
    })

    expect(withDeposit.guestTotalCents).toBe(withoutDeposit.guestTotalCents)
  })

  const table: ReadonlyArray<{
    name: string
    nightlyRateCents: number
    nights: number
    expectedSubtotal: number
    expectedFee: number
    expectedTotal: number
  }> = [
    {
      name: 'single night',
      nightlyRateCents: 12_500,
      nights: 1,
      expectedSubtotal: 12_500,
      expectedFee: 250,
      expectedTotal: 12_750,
    },
    {
      name: 'rounds a half cent up',
      // 25 x 200 / 10000 = 0.5 exactly.
      nightlyRateCents: 25,
      nights: 1,
      expectedSubtotal: 25,
      expectedFee: 1,
      expectedTotal: 26,
    },
    {
      name: 'rounds another half cent up',
      // 75 x 200 / 10000 = 1.5 exactly.
      nightlyRateCents: 75,
      nights: 1,
      expectedSubtotal: 75,
      expectedFee: 2,
      expectedTotal: 77,
    },
    {
      name: 'rounds down below the half cent',
      // 12345 x 200 / 10000 = 246.9
      nightlyRateCents: 12_345,
      nights: 1,
      expectedSubtotal: 12_345,
      expectedFee: 247,
      expectedTotal: 12_592,
    },
    {
      name: 'long stay stays exact',
      nightlyRateCents: 9_999,
      nights: 30,
      expectedSubtotal: 299_970,
      expectedFee: 5_999,
      expectedTotal: 305_969,
    },
  ]

  it.each(table)(
    '$name',
    ({ nightlyRateCents, nights, expectedSubtotal, expectedFee, expectedTotal }) => {
      const result = priceBooking({
        nightlyRateCents,
        nights,
        depositCents: 0,
        networkFeeBps: NETWORK_FEE_BPS,
      })

      expect(result.staySubtotalCents).toBe(expectedSubtotal)
      expect(result.networkFeeCents).toBe(expectedFee)
      expect(result.guestTotalCents).toBe(expectedTotal)
      // The invariant that matters most: the total is exactly its parts.
      expect(result.guestTotalCents).toBe(
        result.staySubtotalCents + result.networkFeeCents,
      )
    },
  )

  it('always returns integer cents', () => {
    for (let rate = 1; rate <= 200; rate += 7) {
      for (let nights = 1; nights <= 9; nights += 1) {
        const result = priceBooking({
          nightlyRateCents: rate,
          nights,
          depositCents: 0,
          networkFeeBps: NETWORK_FEE_BPS,
        })
        expect(Number.isInteger(result.networkFeeCents)).toBe(true)
        expect(Number.isInteger(result.guestTotalCents)).toBe(true)
      }
    }
  })

  it('rejects non-integer and out-of-range inputs', () => {
    const base = {
      nightlyRateCents: 10_000,
      nights: 2,
      depositCents: 0,
      networkFeeBps: NETWORK_FEE_BPS,
    }
    expect(() => priceBooking({ ...base, nightlyRateCents: 100.5 })).toThrow()
    expect(() => priceBooking({ ...base, nightlyRateCents: -1 })).toThrow()
    expect(() => priceBooking({ ...base, nights: 0 })).toThrow()
    expect(() => priceBooking({ ...base, nights: 1.5 })).toThrow()
    expect(() => priceBooking({ ...base, depositCents: -1 })).toThrow()
  })
})

describe('nightsBetween', () => {
  it('counts nights half-open — checkout is not a night', () => {
    expect(nightsBetween('2026-10-01', '2026-10-05')).toBe(4)
    expect(nightsBetween('2026-10-01', '2026-10-02')).toBe(1)
  })

  it('is unaffected by daylight saving shifts', () => {
    // US DST ends 2026-11-01; a UTC-naive local-time diff would return 7.04
    // days here and round wrong.
    expect(nightsBetween('2026-10-28', '2026-11-04')).toBe(7)
  })

  it('rejects a checkout on or before check-in', () => {
    expect(() => nightsBetween('2026-10-05', '2026-10-05')).toThrow()
    expect(() => nightsBetween('2026-10-05', '2026-10-01')).toThrow()
  })
})
