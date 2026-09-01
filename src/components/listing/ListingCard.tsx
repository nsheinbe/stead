import { Link } from 'react-router-dom'
import { formatCentsCompact } from '@/lib/format'
import { photoUrl } from '@/lib/photos'
import { Badge, Card } from '@/components/ui'
import type { ListingWithPhotos } from '@/hooks/useListings'

const POLICY_LABEL: Record<string, string> = {
  flexible: 'Flexible cancellation',
  moderate: 'Moderate cancellation',
  strict: 'Strict cancellation',
}

export function ListingCard({ listing }: { listing: ListingWithPhotos }) {
  const photos = [...(listing.listing_photos ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  )
  const cover = photos[0]

  return (
    <Card className="overflow-hidden">
      <Link to={`/listing/${listing.id}`} className="block">
        <div className="aspect-[4/3] w-full bg-linen">
          {cover ? (
            <img
              src={photoUrl(cover.storage_path)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold leading-snug">{listing.title}</h3>
            {listing.instant_book && <Badge>Instant book</Badge>}
          </div>
          <p className="text-sm text-ink/70">
            {listing.city}, {listing.country}
          </p>
          <p className="text-sm">
            <span className="money font-semibold">
              {formatCentsCompact(listing.nightly_rate_cents)}
            </span>
            <span className="text-ink/70"> / night</span>
          </p>
          <p className="text-xs text-ink/60">
            {POLICY_LABEL[listing.cancellation_policy] ?? listing.cancellation_policy}
          </p>
        </div>
      </Link>
    </Card>
  )
}
