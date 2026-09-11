import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { formatUsd, MIN_STAY_NIGHTS } from "../lib/money";
import { POLICY_LABEL, TYPE_LABEL, type ListingDetail } from "../lib/types";

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
                    <ButtonLink to={`/book/${listing.id}`} block>
                      Choose dates
                    </ButtonLink>
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
              <p className="m-0 mt-3 text-sm text-ink-secondary">
                You'll review the exact price for your dates before anything is charged.
              </p>
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
