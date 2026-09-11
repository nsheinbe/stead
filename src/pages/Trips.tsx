import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { prettyRange } from "../lib/dates";
import { formatUsd } from "../lib/money";
import { TRIP_GROUP_LABEL, tripGroup, tripState, type TripGroup } from "../lib/tripStatus";
import type { TripSummary } from "../lib/types";

const GROUP_ORDER: TripGroup[] = ["needs_attention", "upcoming", "past"];

/**
 * Every stay this member is on.
 *
 * Grouped by what the server says, not by date arithmetic: a stay with no
 * recorded payment goes to the top because it is the only one with anything
 * outstanding, and the rest split into live and finished. Each row says what
 * its status means rather than showing a word the member has to decode.
 */
export function TripsPage() {
  const { user, status } = useAuth();

  const trips = useQuery({
    queryKey: ["trips", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.trips(),
  });

  const rows = trips.data ?? [];
  const grouped = new Map<TripGroup, TripSummary[]>();
  for (const trip of rows) {
    const group = tripGroup(trip.status);
    grouped.set(group, [...(grouped.get(group) ?? []), trip]);
  }

  return (
    <Shell width="narrow" workspace="renter" title="Your stays">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to see your stays"
            description="Your stays, their dates and their status live in your account. We'll bring you straight back here."
            intent="renter"
          />
        ) : (
          <>
            <PageHeader title="Your stays" description="Everything you've booked, and where each one stands." />

            {trips.isPending ? (
              <div className="flex flex-col gap-4" aria-busy="true">
                <p role="status" className="sr-only">
                  Loading your stays
                </p>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : trips.isError ? (
              <StatusMessage
                tone="danger"
                title="We couldn't load your stays."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void trips.refetch()}>
                    Try again
                  </Button>
                }
              >
                <p>Your stays are unaffected — this is about reaching the server.</p>
              </StatusMessage>
            ) : rows.length === 0 ? (
              <EmptyState
                title="You haven't booked a stay yet."
                action={<ButtonLink to="/explore">Find a home</ButtonLink>}
              >
                <p>Homes here are for stays of a month or more. Your booked stays will appear here.</p>
              </EmptyState>
            ) : (
              GROUP_ORDER.filter((group) => grouped.has(group)).map((group) => (
                <section key={group} aria-labelledby={`trips-${group}`} className="flex flex-col gap-4">
                  <h2 id={`trips-${group}`} className="m-0 text-card-title">
                    {TRIP_GROUP_LABEL[group]}
                  </h2>
                  <ul className="m-0 flex list-none flex-col gap-4 p-0">
                    {(grouped.get(group) ?? []).map((trip) => {
                      const state = tripState({
                        status: trip.status,
                        listingId: trip.listing.id,
                        bookingId: trip.id,
                      });
                      return (
                        <li key={trip.id}>
                          <Card padding="sm">
                            <div className="flex gap-4">
                              <div className="w-20 shrink-0 sm:w-28">
                                <ListingPhoto
                                  src={trip.listing.photos[0]?.storagePath}
                                  alt=""
                                  className="rounded-card"
                                />
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col gap-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <h3 className="m-0 text-base font-semibold">
                                    <Link to={`/trips/${trip.id}`}>{trip.listing.title}</Link>
                                  </h3>
                                  <StatusPill tone={state.tone === "brand" ? "brand" : "neutral"}>
                                    {state.label}
                                  </StatusPill>
                                </div>
                                <p className="m-0 text-sm text-ink-secondary">
                                  {prettyRange(trip.checkIn, trip.checkOut)} · {trip.listing.city}
                                </p>
                                <p className="money m-0 text-sm text-ink-secondary">
                                  {formatUsd(trip.guestTotalCents)} · {trip.nights} nights
                                </p>
                                {state.tone === "warning" ? (
                                  <p className="m-0 text-sm text-ink-secondary">{state.meaning}</p>
                                ) : null}
                              </div>
                            </div>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
