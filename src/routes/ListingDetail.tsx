import { useForm } from 'react-hook-form'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { useListing } from '@/hooks/useListings'
import { useNetworkFeeBps } from '@/hooks/useAppConfig'
import { photoUrl } from '@/lib/photos'
import { formatCentsCompact, formatGuests } from '@/lib/format'
import { nightsBetween } from '../../supabase/functions/_shared/pricing'
import { PriceBreakdown } from '@/components/listing/PriceBreakdown'
import { Button, Card, ErrorState, Spinner } from '@/components/ui'

const bookingSchema = z
  .object({
    checkIn: z.string().min(1, 'Pick a check-in date'),
    checkOut: z.string().min(1, 'Pick a check-out date'),
    guests: z.coerce.number().int().min(1, 'At least one guest'),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  })

type BookingForm = z.input<typeof bookingSchema>

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: listing, isLoading, error } = useListing(id)
  const { data: networkFeeBps } = useNetworkFeeBps()
  const navigate = useNavigate()

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors },
  } = useForm<BookingForm>({ defaultValues: { guests: 1 } })

  const checkIn = watch('checkIn')
  const checkOut = watch('checkOut')

  let nights = 0
  if (checkIn && checkOut) {
    try {
      nights = nightsBetween(checkIn, checkOut)
    } catch {
      nights = 0
    }
  }

  if (isLoading) return <Spinner label="Loading home…" />
  if (error) {
    return (
      <ErrorState
        title="Could not load this home"
        body="Something went wrong reaching the server. Try again in a moment."
      />
    )
  }
  if (!listing) {
    return (
      <ErrorState title="Home not found" body="This listing is no longer available." />
    )
  }

  const photos = [...(listing.listing_photos ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  )

  function onSubmit(values: BookingForm) {
    const parsed = bookingSchema.safeParse(values)
    if (!parsed.success || !listing) return
    const params = new URLSearchParams({
      listing: listing.id,
      in: parsed.data.checkIn,
      out: parsed.data.checkOut,
      guests: String(parsed.data.guests),
    })
    navigate(`/checkout?${params.toString()}`)
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <h1 className="text-2xl font-bold">{listing.title}</h1>
        <p className="mt-1 text-sm text-ink/70">
          {listing.city}, {listing.country}
        </p>

        {photos.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {photos.slice(0, 4).map((photo) => (
              <img
                key={photo.id}
                src={photoUrl(photo.storage_path)}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full rounded-card object-cover"
              />
            ))}
          </div>
        )}

        {listing.description && (
          <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-ink/80">
            {listing.description}
          </p>
        )}

        <p className="mt-6 text-sm text-ink/70">
          Sleeps {listing.max_guests}. Check-in and check-out follow local time in{' '}
          {listing.timezone.replace('_', ' ')}.
        </p>
      </div>

      <Card className="h-fit p-5">
        <p className="text-lg">
          <span className="money font-semibold">
            {formatCentsCompact(listing.nightly_rate_cents)}
          </span>
          <span className="text-sm text-ink/70"> / night</span>
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="checkIn" className="block text-xs font-medium">
                Check in
              </label>
              <input
                id="checkIn"
                type="date"
                {...register('checkIn')}
                className="mt-1 w-full rounded-lg border border-linen-tint bg-paper px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="checkOut" className="block text-xs font-medium">
                Check out
              </label>
              <input
                id="checkOut"
                type="date"
                {...register('checkOut')}
                className="mt-1 w-full rounded-lg border border-linen-tint bg-paper px-2 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="guests" className="block text-xs font-medium">
              Guests
            </label>
            <input
              id="guests"
              type="number"
              min={1}
              max={listing.max_guests}
              {...register('guests')}
              className="mt-1 w-full rounded-lg border border-linen-tint bg-paper px-2 py-2 text-sm"
            />
          </div>

          {errors.checkOut && (
            <p className="text-xs text-claim">{errors.checkOut.message}</p>
          )}
          {errors.guests && <p className="text-xs text-claim">{errors.guests.message}</p>}

          {nights > 0 && networkFeeBps !== undefined && (
            <div className="border-t border-linen-tint pt-3">
              <PriceBreakdown
                nightlyRateCents={listing.nightly_rate_cents}
                nights={nights}
                depositCents={listing.deposit_cents}
                networkFeeBps={networkFeeBps}
              />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={nights <= 0}>
            Review and pay
          </Button>
          <p className="text-center text-xs text-ink/60">
            {formatGuests(Number(watch('guests')) || 1)} · you're not charged yet
          </p>
        </form>
      </Card>
    </div>
  )
}
