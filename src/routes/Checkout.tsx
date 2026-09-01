import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/hooks/useSession'
import { Card, EmptyState, ErrorState, Spinner } from '@/components/ui'

interface CreateBookingResult {
  booking_id: string
  client_secret: string | null
}

interface FunctionError {
  code: string
  message: string
}

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

export default function Checkout() {
  const [params] = useSearchParams()
  const { session, loading: sessionLoading } = useSession()
  const [result, setResult] = useState<CreateBookingResult | null>(null)
  const [failure, setFailure] = useState<FunctionError | null>(null)
  const [pending, setPending] = useState(false)

  const listingId = params.get('listing')
  const checkIn = params.get('in')
  const checkOut = params.get('out')
  const guests = Number(params.get('guests') ?? '1')

  useEffect(() => {
    if (sessionLoading || !session || !listingId || !checkIn || !checkOut) return
    if (result || failure || pending) return

    setPending(true)
    void supabase.functions
      .invoke('create-booking', {
        body: { listing_id: listingId, check_in: checkIn, check_out: checkOut, guests },
      })
      .then(({ data, error }) => {
        if (error) {
          setFailure({
            code: 'request_failed',
            message: 'We could not reach the booking service.',
          })
          return
        }
        if (data && 'error' in data) {
          setFailure(data.error as FunctionError)
          return
        }
        setResult(data as CreateBookingResult)
      })
      .finally(() => setPending(false))
  }, [
    sessionLoading, session, listingId, checkIn, checkOut, guests,
    result, failure, pending,
  ])

  if (sessionLoading) return <Spinner />
  if (!session) {
    return (
      <EmptyState
        title="Sign in to finish booking"
        body="Your dates are not held until you're signed in and the booking is created."
      />
    )
  }
  if (!listingId || !checkIn || !checkOut) {
    return (
      <ErrorState
        title="Missing booking details"
        body="Go back to the home and pick your dates again."
      />
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold">Confirm and pay</h1>

      <div className="mt-6 space-y-4">
        {pending && <Spinner label="Holding your dates…" />}

        {failure && (
          <ErrorState
            title={
              failure.code === 'dates_unavailable'
                ? 'Those dates just went'
                : 'Could not start this booking'
            }
            body={failure.message}
          />
        )}

        {result && !stripePublishableKey && (
          <Card className="p-6">
            <h2 className="text-base font-semibold">Your dates are held</h2>
            <p className="mt-2 text-sm text-ink/70">
              Booking {result.booking_id.slice(0, 8)} is holding these dates while
              payment is set up. Card payment is not configured on this environment
              yet, so there is nothing to charge against — the hold releases on its
              own if payment isn't completed.
            </p>
            <Link
              to="/trips"
              className="mt-4 inline-block text-sm font-semibold text-spruce underline"
            >
              See it in your trips
            </Link>
          </Card>
        )}

        {result && stripePublishableKey && result.client_secret && (
          <Card className="p-6">
            <h2 className="text-base font-semibold">Payment</h2>
            <p className="mt-2 text-sm text-ink/70">
              Your dates are held. Complete payment to confirm the booking.
            </p>
            {/* Stripe Payment Element mounts here once keys are configured. */}
          </Card>
        )}
      </div>
    </div>
  )
}
