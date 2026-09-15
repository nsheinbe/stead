import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BookingsClosed } from "../components/BookingsClosed";
import { CancellationPolicyCard } from "../components/CancellationPolicyCard";
import { ListingPhoto } from "../components/ListingPhoto";
import { DepositNote, PriceBreakdown } from "../components/PriceBreakdown";
import { Shell } from "../components/Shell";
import { Button, ButtonLink, Card, PageHeader, Skeleton, StatusMessage, StatusPill, Surface } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { loginHref } from "../lib/continuation";
import { depositMethodForNights } from "../lib/deposit";
import { estimateMinimumStay } from "../lib/estimate";
import { feePercent } from "../lib/fees";
import { guestBookingsOpen } from "../lib/guestBookings";
import { formatUsd, MIN_STAY_NIGHTS } from "../lib/money";
import { POLICY_LABEL, TYPE_LABEL, type ListingDetail, type ListingHonesty } from "../lib/types";
import { formatInTimeZone } from "date-fns-tz";
import {
  HONESTY_BADGE,
  HONESTY_CAPTURED,
  HONESTY_GUEST_DISCLOSURE,
  WALK_COPY,
} from "../lib/honestyCopy";

/** Amenities the contract actually carries. Absent is not the same as false. */
function amenityList(listing: ListingDetail): string[] {
  const a = listing.amenities;
  const out: string[] = [];
  if (typeof a.bedrooms === "number") out.push(`${a.bedrooms} ${a.bedrooms === 1 ? "bedroom" : "bedrooms"}`);
  if (typeof a.beds === "number") out.push(`${a.beds} ${a.beds === 1 ? "bed" : "beds"}`);
  if (a.wifi) out.push("Wi-Fi");
  if (a.kitchen) out.push("Kitchen");
  if (a.fireplace) out.push("Fireplace");
  if (a.courtyard) out.push("Courtyard");
  return out;
}

export function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [photoIndex, setPhotoIndex] = useState(0);

  const listingQuery = useQuery({
    queryKey: ["listing", id],
    enabled: Boolean(id),
    queryFn: () => api.listing(id as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });

  const listing = listingQuery.data;
  const feeBps = config.data?.networkFeeBps ?? null;
  const bookingsOpen = guestBookingsOpen(config.data);
  const notFound = listingQuery.error instanceof ApiError && listingQuery.error.status === 404;
  const estimate = listing ? estimateMinimumStay(listing.nightlyRateCents, feeBps) : null;
  const isOwner = Boolean(listing?.host && user && listing.host.id === user.id);
  const photos = listing?.photos ?? [];
  const current = photos[photoIndex];

  if (listingQuery.isPending) {
    return (
      <Shell title="Home details">
        <div className="flex flex-1 flex-col gap-6 py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Loading this home
          </p>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="aspect-[2/1] w-full" />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </Shell>
    );
  }

  if (notFound || !listing) {
    return (
      <Shell width="narrow" title="Home details">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="We couldn't find this home."
            description="It may no longer be listed, or the link may be out of date."
          />
          <div className="flex flex-wrap gap-3">
            <ButtonLink to="/explore">Find a home</ButtonLink>
          </div>
        </div>
      </Shell>
    );
  }

  if (listingQuery.isError) {
    return (
      <Shell width="narrow" title="Home details">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <StatusMessage
            tone="danger"
            title="We couldn't load this home."
            action={
              <Button variant="secondary" size="sm" onClick={() => void listingQuery.refetch()}>
                Try again
              </Button>
            }
          />
          <ButtonLink to="/explore" variant="secondary">
            Find a home
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const amenities = amenityList(listing);
  const place = [listing.city, listing.region, listing.country].filter(Boolean).join(", ");

  return (
    <Shell title="Home details">
      <div className="flex flex-1 flex-col gap-8 py-6 sm:py-8">
        <div className="flex flex-col gap-3">
          <Link to="/explore" className="text-sm font-semibold">
            ← All homes
          </Link>
          {listing.status !== "active" ? (
            <StatusMessage
              tone="warning"
              live={false}
              title={`You're previewing your ${listing.status} listing.`}
            >
              <p>It is not publicly available for bookings.</p>
            </StatusMessage>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">{place}</p>
            <h1 className="m-0 text-[2rem] sm:text-page-title">{listing.title}</h1>
            <p className="m-0 text-ink-secondary">
              {TYPE_LABEL[listing.type]} · Sleeps {listing.maxGuests} · Stays of {MIN_STAY_NIGHTS} nights or more
            </p>
          </div>
        </div>

        {/* --- gallery ------------------------------------------------- */}
        <div className="flex flex-col gap-3">
          <ListingPhoto
            src={current?.storagePath}
            alt={photos.length > 0 ? `${listing.title}, photo ${photoIndex + 1} of ${photos.length}` : ""}
            aspect="2/1"
            className="rounded-surface"
            sizes="(min-width: 1024px) 1100px, 100vw"
            priority
          />
          {photos.length > 1 ? (
            <div className="flex flex-col gap-2">
              <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
                {photos.map((photo, index) => (
                  <li key={photo.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setPhotoIndex(index)}
                      aria-current={index === photoIndex}
                      className={`block w-24 overflow-hidden rounded-control border-2 ${
                        index === photoIndex ? "border-brand" : "border-transparent"
                      }`}
                    >
                      <ListingPhoto src={photo.storagePath} alt="" aspect="4/3" />
                      <span className="sr-only">Show photo {index + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="m-0 text-sm text-ink-secondary">
                Photo {photoIndex + 1} of {photos.length}
              </p>
            </div>
          ) : null}
        </div>

        {/* --- the walkthrough (HM-D06) -------------------------------- */}
        {listing.honesty ? <WalkthroughEntry listing={listing} honesty={listing.honesty} /> : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] lg:items-start">
          {/* --- the home ---------------------------------------------- */}
          <div className="flex flex-col gap-8">
            {listing.description ? (
              <section aria-labelledby="about-heading">
                <h2 id="about-heading" className="m-0 text-card-title">
                  About this home
                </h2>
                <p className="mb-0 mt-3 max-w-reading whitespace-pre-line text-ink-secondary">
                  {listing.description}
                </p>
              </section>
            ) : null}

            {amenities.length > 0 ? (
              <section aria-labelledby="amenities-heading">
                <h2 id="amenities-heading" className="m-0 text-card-title">
                  What's here
                </h2>
                <ul className="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">
                  {amenities.map((item) => (
                    <li key={item} className="text-ink-secondary">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="host-heading">
              <h2 id="host-heading" className="m-0 text-card-title">
                Your host
              </h2>
              {listing.host ? (
                <Card className="mt-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface-accent font-semibold text-brand"
                    >
                      {listing.host.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 font-semibold">{listing.host.displayName}</p>
                      <Link to={`/passport/${listing.host.id}`} className="text-sm font-semibold">
                        View profile
                      </Link>
                    </div>
                  </div>
                </Card>
              ) : (
                <p className="mb-0 mt-3 text-ink-secondary">Host details are unavailable for this home.</p>
              )}
            </section>

            <section aria-labelledby="terms-heading">
              <h2 id="terms-heading" className="m-0 text-card-title">
                Before you book
              </h2>
              <div className="mt-3 flex flex-col gap-4">
                <CancellationPolicyCard policy={listing.cancellationPolicy} />
                <DepositNote
                  amountCents={listing.depositCents}
                  method={depositMethodForNights(MIN_STAY_NIGHTS)}
                  claimWindowHours={config.data?.claimWindowHours ?? null}
                />
              </div>
            </section>
          </div>

          {/* --- price and action --------------------------------------- */}
          <aside className="lg:sticky lg:top-28">
            <Card>
              {estimate ? (
                <>
                  <p className="money m-0 text-[1.75rem] font-semibold">{formatUsd(estimate.guestTotalCents)}</p>
                  <p className="m-0 text-sm text-ink-secondary">
                    Estimated stay total · {estimate.nights} nights
                  </p>
                  <div className="mt-4">
                    <PriceBreakdown
                      nightlyRateCents={listing.nightlyRateCents}
                      nights={estimate.nights}
                      staySubtotalCents={estimate.staySubtotalCents}
                      networkFeeCents={estimate.networkFeeCents}
                      guestTotalCents={estimate.guestTotalCents}
                      networkFeeBps={estimate.networkFeeBps}
                    />
                  </div>
                  <p className="m-0 mt-3 text-sm text-ink-secondary">
                    Based on {formatUsd(listing.nightlyRateCents)} per night, plus the{" "}
                    {feePercent(estimate.networkFeeBps)} guest network fee. Deposit arrangement shown separately.
                  </p>
                </>
              ) : (
                <>
                  <p className="money m-0 text-[1.75rem] font-semibold">
                    {formatUsd(listing.nightlyRateCents)}
                  </p>
                  <p className="m-0 text-sm text-ink-secondary">per night · fees shown at checkout</p>
                </>
              )}

              <div className="mt-5 flex flex-col gap-3">
                {isOwner ? (
                  <ButtonLink to={`/host/listings/${listing.id}`} block>
                    Edit your home
                  </ButtonLink>
                ) : (
                  <>
                    {config.isPending ? null : bookingsOpen ? (
                      <ButtonLink to={`/book/${listing.id}`} block>
                        Choose dates
                      </ButtonLink>
                    ) : (
                      <BookingsClosed />
                    )}
                    {listing.host ? (
                      <ButtonLink
                        to={
                          user
                            ? `/messages/${listing.id}`
                            : loginHref({ next: `/messages/${listing.id}`, source: "listing_message" })
                        }
                        variant="secondary"
                        block
                      >
                        Message {listing.host.displayName}
                      </ButtonLink>
                    ) : null}
                  </>
                )}
              </div>
              {bookingsOpen ? (
                <p className="m-0 mt-3 text-sm text-ink-secondary">
                  You'll review the exact price for your dates before anything is charged.
                </p>
              ) : null}
            </Card>

            <Surface padding="sm" className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill>{POLICY_LABEL[listing.cancellationPolicy]}</StatusPill>
                {listing.instantBook ? <StatusPill tone="brand">Instant book</StatusPill> : null}
              </div>
              <p className="m-0 mt-3 text-sm text-ink-secondary">
                Check-in and checkout follow this home's time zone ({listing.timezone}).
              </p>
            </Surface>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

/**
 * HM-05 (HM-D06) — the way into the walk, and the facts that go with it.
 *
 * Rendered only when the server sent `honesty`, which means this listing has
 * a verified walkthrough a guest may see, or its own host is previewing.
 * There is deliberately no "walkthrough coming soon": a guest is told what
 * exists, not what might.
 */
function WalkthroughEntry({ listing, honesty }: { listing: ListingDetail; honesty: ListingHonesty }) {
  const capturedOn = honesty.capturedOn
    ? formatInTimeZone(`${honesty.capturedOn}T12:00:00Z`, listing.timezone, "d MMM yyyy")
    : null;
  const coverage = HONESTY_CAPTURED.coverage[honesty.coverage];

  return (
    <section aria-labelledby="walkthrough-heading">
      <h2 id="walkthrough-heading" className="m-0 mb-3 text-card-title">
        {WALK_COPY.heading}
      </h2>
      <Card>
        <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
          <div className="flex flex-col gap-3">
            <ListingPhoto
              src={honesty.posterUrl}
              alt=""
              aspect="16/9"
              className="rounded-surface"
              sizes="(min-width: 640px) 520px, 100vw"
            />
            <ButtonLink to={`/listing/${listing.id}/walk`} className="self-start" data-testid="walk-enter">
              {WALK_COPY.enter}
            </ButtonLink>
          </div>
          <div className="flex flex-col gap-3">
            <StatusPill tone="brand" testId="walk-badge-detail">
              <span className="hidden sm:inline">{HONESTY_BADGE.full}</span>
              <span className="sm:hidden">{HONESTY_BADGE.short}</span>
            </StatusPill>
            {capturedOn ? (
              <div className="flex flex-col gap-1">
                <p className="m-0 font-semibold" data-testid="walk-captured-detail">
                  {HONESTY_CAPTURED.capturedOn(capturedOn)}
                </p>
                <p className="m-0 text-sm text-ink-secondary">{HONESTY_CAPTURED.hint}</p>
              </div>
            ) : null}
            <p className="m-0 text-sm" data-testid="walk-coverage-detail">
              <strong>{coverage.label}</strong> — {coverage.body}
            </p>
            {honesty.ownerPreview ? (
              <p className="m-0 text-sm text-ink-secondary" data-testid="walk-owner-note">
                {WALK_COPY.ownerPreview}
              </p>
            ) : null}
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">{HONESTY_GUEST_DISCLOSURE.title}</summary>
              <div className="mt-2 flex flex-col gap-2 text-ink-secondary">
                {HONESTY_GUEST_DISCLOSURE.paragraphs.map((paragraph) => (
                  <p key={paragraph.slice(0, 24)} className="m-0 leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          </div>
        </div>
      </Card>
    </section>
  );
}
