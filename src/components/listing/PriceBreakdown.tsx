import { priceBooking } from '../../../supabase/functions/_shared/pricing'
import { formatCents } from '@/lib/format'
import { formatNights } from '@/lib/format'

interface Props {
  nightlyRateCents: number
  nights: number
  depositCents: number
  networkFeeBps: number
}

/**
 * Display-only mirror of the server's math — same module, same inputs. The
 * figures written to the booking are always recomputed in the edge function.
 */
export function PriceBreakdown(props: Props) {
  const price = priceBooking(props)
  const feePercent = props.networkFeeBps / 100

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-ink/70">
          {formatCents(price.nightlyRateCents)} x {formatNights(price.nights)}
        </dt>
        <dd className="money">{formatCents(price.staySubtotalCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-ink/70">Network fee ({feePercent}%)</dt>
        <dd className="money">{formatCents(price.networkFeeCents)}</dd>
      </div>
      <div className="flex justify-between border-t border-linen-tint pt-2 font-semibold">
        <dt>Total</dt>
        <dd className="money">{formatCents(price.guestTotalCents)}</dd>
      </div>
      {price.depositCents > 0 && (
        <div className="flex justify-between rounded-lg bg-linen px-3 py-2 text-xs">
          <dt className="text-ink/70">
            Refundable deposit, held in neutral escrow
          </dt>
          <dd className="money">{formatCents(price.depositCents)}</dd>
        </div>
      )}
    </dl>
  )
}
