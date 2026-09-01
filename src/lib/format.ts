/** Money is integer cents everywhere; formatting is the only place it becomes
 *  a decimal, and it never round-trips back into arithmetic. */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatCents(cents: number): string {
  return usd.format(cents / 100)
}

/** Drops the trailing .00 on whole-dollar amounts, for headline prices. */
export function formatCentsCompact(cents: number): string {
  return cents % 100 === 0
    ? usd.format(cents / 100).replace(/\.00$/, '')
    : usd.format(cents / 100)
}

export function formatNights(nights: number): string {
  return nights === 1 ? '1 night' : `${nights} nights`
}

export function formatGuests(guests: number): string {
  return guests === 1 ? '1 guest' : `${guests} guests`
}
