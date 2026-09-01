import { Link } from 'react-router-dom'
import { useMyBookings } from '@/hooks/useBookings'
import { useSession } from '@/hooks/useSession'
import { formatCents } from '@/lib/format'
import { formatStayRange } from '@/lib/dates'
import { Badge, Card, EmptyState, ErrorState, Spinner } from '@/components/ui'
import type { BookingStatus } from '@/types/database'

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  canceled_by_guest: 'Canceled by you',
  canceled_by_host: 'Canceled by host',
  expired: 'Expired',
}

export default function Trips() {
  const { session, loading: sessionLoading } = useSession()
  const { data, isLoading, error } = useMyBookings(Boolean(session))

  if (sessionLoading) return <Spinner />
  if (!session) {
    return (
      <EmptyState
        title="Sign in to see your trips"
        body="Your bookings live here once you've signed in."
      />
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Your trips</h1>

      <div className="mt-6 space-y-4">
        {isLoading && <Spinner label="Loading trips…" />}
        {error && (
          <ErrorState
            title="Could not load your trips"
            body="Something went wrong reaching the server. Try again in a moment."
          />
        )}
        {data && data.length === 0 && (
          <EmptyState
            title="No trips yet"
            body="When you book a home, it'll show up here."
          />
        )}
        {data?.map((booking) => (
          <Card key={booking.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  {booking.listings ? (
                    <Link to={`/listing/${booking.listings.id}`}>
                      {booking.listings.title}
                    </Link>
                  ) : (
                    'Home'
                  )}
                </h2>
                <p className="mt-1 text-sm text-ink/70">
                  {booking.listings
                    ? formatStayRange(
                        booking.check_in,
                        booking.check_out,
                        booking.listings.timezone,
                      )
                    : `${booking.check_in} – ${booking.check_out}`}
                </p>
              </div>
              <Badge>{STATUS_LABEL[booking.status]}</Badge>
            </div>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-ink/70">Paid</dt>
                <dd className="money font-medium">
                  {formatCents(booking.guest_total_cents)}
                </dd>
              </div>
              {booking.deposit_cents > 0 && (
                <div className="flex gap-2">
                  <dt className="text-ink/70">Deposit in escrow</dt>
                  <dd className="money font-medium">
                    {formatCents(booking.deposit_cents)}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  )
}
