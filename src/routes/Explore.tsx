import { useListings } from '@/hooks/useListings'
import { ListingCard } from '@/components/listing/ListingCard'
import { EmptyState, ErrorState, Spinner } from '@/components/ui'

export default function Explore() {
  const { data, isLoading, error } = useListings()

  return (
    <div>
      <h1 className="text-2xl font-bold">Explore homes</h1>
      <p className="mt-2 text-sm text-ink/70">
        A flat 2% network fee. Deposits held in neutral escrow, never by the host.
      </p>

      <div className="mt-6">
        {isLoading && <Spinner label="Loading homes…" />}
        {error && (
          <ErrorState
            title="Could not load homes"
            body="Something went wrong reaching the server. Try again in a moment."
          />
        )}
        {data && data.length === 0 && (
          <EmptyState
            title="No homes yet"
            body="Once hosts publish their listings, they'll show up here."
          />
        )}
        {data && data.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
