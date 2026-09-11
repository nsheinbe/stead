import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { formatUsd } from "../lib/money";
import type { HostListing, ListingStatus } from "../lib/types";

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  active: "Published",
  paused: "Paused",
};

const STATUS_NOTE: Record<ListingStatus, string> = {
  draft: "Only you can see this home.",
  active: "Guests can find this home and request stays.",
  paused: "Off the market. Existing stays are unaffected.",
};

/**
 * The homeowner's dashboard.
 *
 * Creation lives at `/host/start`, which is the one canonical path: a listing
 * needs a complete, valid set of fields before `POST /api/listings` will take
 * it, and a wizard is the honest way to collect them. This page lists what
 * exists and changes its state.
 *
 * "Published" and "payout-ready" are different facts and are shown as
 * different facts. A home can be visible while a stay still cannot charge,
 * because the server fails closed without a Stripe payout account.
 */
export function HostListingsPage() {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<HostListing | null>(null);

  const listings = useQuery({
    queryKey: ["host-listings", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.hostListings(),
  });

  const connect = useQuery({
    queryKey: ["connect-status", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.connectStatus(),
  });
  const payoutsReady = Boolean(connect.data?.chargesEnabled && connect.data?.payoutsEnabled);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["host-listings", user?.id] });

  const setListingStatus = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: ListingStatus }) =>
      api.updateListing(id, { status: next }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteListing(id),
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
    },
  });

  const rows = listings.data ?? [];
  const published = rows.filter((row) => row.status === "active").length;

  return (
    <Shell width="narrow" workspace="hosting" title="Your homes">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <HostSubnav />

        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to manage your homes"
            description="Create an account or sign in to save your home as a draft. You choose when to publish it."
            intent="homeowner"
            source="homeowner_hero"
            action="Continue with your email"
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <PageHeader title="Your homes" description="Add one, edit it, and publish it when you're ready." />
              <ButtonLink to="/host/start">Add a home</ButtonLink>
            </div>

            {connect.data && !payoutsReady && published > 0 ? (
              <StatusMessage
                tone="warning"
                title="Your published homes can't take payment yet."
                action={
                  <ButtonLink to="/host/payouts" variant="secondary" size="sm">
                    Set up payouts
                  </ButtonLink>
                }
              >
                <p>
                  Guests pay you directly through Stripe. Until your payout account is ready, a guest cannot
                  complete a booking for {published === 1 ? "this home" : "these homes"}.
                </p>
              </StatusMessage>
            ) : null}

            {connect.data && !payoutsReady && published === 0 ? (
              <Surface padding="sm">
                <p className="m-0 text-sm text-ink-secondary">
                  Payout setup is separate from publishing, and both are needed before a guest can pay.{" "}
                  <Link to="/host/payouts" className="font-semibold">
                    Set up payouts
                  </Link>
                  .
                </p>
              </Surface>
            ) : null}

            {listings.isPending ? (
              <div className="flex flex-col gap-4" aria-busy="true">
                <p role="status" className="sr-only">
                  Loading your homes
                </p>
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : listings.isError ? (
              <StatusMessage
                tone="danger"
                title="We couldn't load your homes."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void listings.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title="You haven't added a home yet."
                action={<ButtonLink to="/host/start">Add a home</ButtonLink>}
              >
                <p>A new home starts as a draft. Nobody can see it until you publish it.</p>
              </EmptyState>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-4 p-0">
                {rows.map((listing) => (
                  <li key={listing.id}>
                    <Card>
                      <div className="flex flex-col gap-4 sm:flex-row">
                        <div className="w-full shrink-0 sm:w-40">
                          <ListingPhoto
                            src={listing.photos[0]?.storagePath}
                            alt=""
                            className="rounded-card"
                          />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h2 className="m-0 text-base font-semibold">
                                <Link to={`/host/listings/${listing.id}`}>
                                  {listing.title || "Untitled home"}
                                </Link>
                              </h2>
                              <p className="m-0 text-sm text-ink-secondary">
                                {listing.city}, {listing.country} · sleeps {listing.maxGuests}
                              </p>
                              <p className="money m-0 text-sm text-ink-secondary">
                                {formatUsd(listing.nightlyRateCents)} per night
                              </p>
                            </div>
                            <StatusPill tone={listing.status === "active" ? "brand" : "neutral"}>
                              {STATUS_LABEL[listing.status]}
                            </StatusPill>
                          </div>

                          <p className="m-0 text-sm text-ink-secondary">{STATUS_NOTE[listing.status]}</p>

                          <div className="flex flex-wrap gap-2">
                            <ButtonLink to={`/host/listings/${listing.id}`} variant="secondary" size="sm">
                              Edit this home
                            </ButtonLink>
                            {listing.status === "active" ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                busy={
                                  setListingStatus.isPending &&
                                  setListingStatus.variables?.id === listing.id
                                }
                                onClick={() =>
                                  setListingStatus.mutate({ id: listing.id, status: "paused" })
                                }
                              >
                                Take it off the market
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                busy={
                                  setListingStatus.isPending &&
                                  setListingStatus.variables?.id === listing.id
                                }
                                onClick={() =>
                                  setListingStatus.mutate({ id: listing.id, status: "active" })
                                }
                              >
                                Publish this home
                              </Button>
                            )}
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(listing)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            {setListingStatus.isError ? (
              <StatusMessage tone="danger" title="We couldn't change that home's status.">
                <p>
                  {setListingStatus.error instanceof ApiError
                    ? setListingStatus.error.message
                    : "Nothing changed. Please try again."}
                </p>
              </StatusMessage>
            ) : null}

            <Dialog
              open={confirmDelete !== null}
              onClose={() => setConfirmDelete(null)}
              title="Delete this home?"
              description={
                confirmDelete
                  ? `“${confirmDelete.title || "Untitled home"}” and its photos will be removed. This cannot be undone.`
                  : undefined
              }
              size="sm"
            >
              <p className="m-0 text-sm text-ink-secondary">
                A home with stays booked against it cannot be deleted — take it off the market instead, so
                those stays survive.
              </p>
              {remove.isError ? (
                <div className="mt-4">
                  <StatusMessage
                    tone="danger"
                    title={
                      remove.error instanceof ApiError
                        ? remove.error.message
                        : "We couldn't delete that home. Please try again."
                    }
                  />
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  busy={remove.isPending}
                  busyLabel="Deleting…"
                  onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
                >
                  Delete this home
                </Button>
                <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                  Keep it
                </Button>
              </div>
            </Dialog>
          </>
        )}
      </div>
    </Shell>
  );
}
