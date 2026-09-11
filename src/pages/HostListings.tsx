import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { clearHostPrecreateDraft, readHostPrecreateDraft, saveHostPrecreateDraft } from "../lib/drafts";
import { formatUsd } from "../lib/money";
import { StatusMessage } from "../components/ui";
import type { HostListing, ListingInput, ListingStatus } from "../lib/types";

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  active: "Live",
  paused: "Paused",
};

/** The browser knows its own zone, which is the right default for a new home. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const EMPTY: ListingInput = {
  title: "",
  type: "entire_home",
  city: "",
  country: "US",
  timezone: localTimeZone(),
  nightlyRateCents: 20000,
  depositCents: 30000,
  maxGuests: 2,
};

export function HostListingsPage() {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ListingInput>(EMPTY);
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(params.get("create") === "1");
  const [precreateNotice, setPrecreateNotice] = useState<"restored" | "unavailable" | null>(null);
  const restoredPrecreate = useRef(false);

  /**
   * Bring back the essentials this device remembered from before sign-in.
   * Only the non-sensitive ones are kept (INT-03): a title, the kind of home,
   * city, country, time zone and capacity. Rate, deposit, address and
   * description are never written to anonymous storage, so they start empty.
   */
  useEffect(() => {
    if (restoredPrecreate.current || status !== "signed_in") return;
    restoredPrecreate.current = true;
    const result = readHostPrecreateDraft(user?.id ?? null);
    if (result.status === "unavailable") {
      setPrecreateNotice("unavailable");
      return;
    }
    if (result.status !== "restored") return;
    const fields = result.draft.fields;
    if (Object.keys(fields).length === 0) return;
    setDraft((current) => ({ ...current, ...fields }));
    setCreating(true);
    setPrecreateNotice("restored");
  }, [status, user?.id]);

  /** Keep the essentials on this device while the member is filling them in. */
  function rememberPrecreate(next: ListingInput) {
    const saved = saveHostPrecreateDraft(
      {
        title: next.title || undefined,
        type: next.type,
        city: next.city || undefined,
        country: next.country || undefined,
        timezone: next.timezone || undefined,
        maxGuests: next.maxGuests,
      },
      user?.id ?? null,
    );
    if (!saved.ok) setPrecreateNotice("unavailable");
  }

  function updateDraft(patch: Partial<ListingInput>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      rememberPrecreate(next);
      return next;
    });
  }

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
  const payoutsReady = connect.data?.chargesEnabled && connect.data?.payoutsEnabled;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["host-listings", user?.id] });

  const create = useMutation({
    mutationFn: (input: ListingInput) => api.createListing(input),
    onSuccess: async () => {
      clearHostPrecreateDraft();
      setPrecreateNotice(null);
      setDraft({ ...EMPTY, timezone: localTimeZone() });
      setCreating(false);
      await invalidate();
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ListingStatus }) =>
      api.updateListing(id, { status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteListing(id),
    onSuccess: invalidate,
  });

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        <HostSubnav />
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-2xl font-semibold">Your homes</h1>
          {user && (
            <button
              type="button"
              onClick={() => setCreating((open) => !open)}
              className="rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper"
            >
              {creating ? "Cancel" : "Add a home"}
            </button>
          )}
        </div>

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
            {connect.data && !payoutsReady && (
              <div className="flex flex-col gap-2 rounded-card border border-linen-tint bg-linen px-4 py-3.5">
                <span className="text-sm font-bold">Set up payouts before a guest books</span>
                <p className="m-0 text-[12.5px] leading-relaxed text-ink/65">
                  Guests pay you directly. A listing can go live now; a stay cannot charge until
                  Stripe has your payout account.
                </p>
                <Link
                  to="/host/payouts"
                  className="self-start text-sm font-bold text-spruce no-underline"
                >
                  Continue to payouts
                </Link>
              </div>
            )}
            {creating && precreateNotice === "restored" ? (
              <StatusMessage
                tone="success"
                title="We brought back what you'd started."
                action={
                  <button
                    type="button"
                    onClick={() => {
                      clearHostPrecreateDraft();
                      setPrecreateNotice(null);
                      setDraft({ ...EMPTY, timezone: localTimeZone() });
                    }}
                    className="text-sm font-semibold underline"
                  >
                    Start over
                  </button>
                }
              >
                <p>Check the details below. Your home isn't saved to your account until you save it.</p>
              </StatusMessage>
            ) : null}
            {creating && precreateNotice === "unavailable" ? (
              <StatusMessage tone="warning" title="Your entries couldn't be saved on this device.">
                <p>You can still fill in the form and save. Leaving the page may mean starting again.</p>
              </StatusMessage>
            ) : null}
            {creating && (
              <form
                className="flex flex-col gap-3 rounded-card border border-linen-tint p-[18px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate(draft);
                }}
              >
                <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                  TITLE
                  <input
                    required
                    minLength={3}
                    value={draft.title}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink/60">
                    CITY
                    <input
                      required
                      value={draft.city}
                      onChange={(e) => updateDraft({ city: e.target.value })}
                      className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                    />
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs font-bold text-ink/60">
                    COUNTRY
                    <input
                      required
                      maxLength={2}
                      value={draft.country}
                      onChange={(e) => updateDraft({ country: e.target.value.toUpperCase() })}
                      className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal uppercase text-ink"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                  TIME ZONE
                  <input
                    required
                    value={draft.timezone}
                    onChange={(e) => updateDraft({ timezone: e.target.value })}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                  <span className="text-[11px] font-normal text-ink/50">
                    Check-in and checkout run on this clock, so it has to be a real IANA zone.
                  </span>
                </label>
                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink/60">
                    NIGHTLY (USD)
                    <input
                      type="number"
                      min={1}
                      value={draft.nightlyRateCents / 100}
                      onChange={(e) =>
                        setDraft((c) => ({ ...c, nightlyRateCents: Math.round(Number(e.target.value) * 100) }))
                      }
                      className="money rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink/60">
                    DEPOSIT (USD)
                    <input
                      type="number"
                      min={0}
                      value={draft.depositCents / 100}
                      onChange={(e) =>
                        setDraft((c) => ({ ...c, depositCents: Math.round(Number(e.target.value) * 100) }))
                      }
                      className="money rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                    />
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs font-bold text-ink/60">
                    SLEEPS
                    <input
                      type="number"
                      min={1}
                      value={draft.maxGuests}
                      onChange={(e) => updateDraft({ maxGuests: Number(e.target.value) })}
                      className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                    />
                  </label>
                </div>
                {create.isError && (
                  <StatusBanner
                    tone="claim"
                    title="Could not save this home"
                    detail={
                      create.error instanceof ApiError
                        ? create.error.message
                        : "Something went wrong. Try again."
                    }
                  />
                )}
                <button
                  type="submit"
                  disabled={create.isPending}
                  className="self-start rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
                >
                  {create.isPending ? "Saving…" : "Save as draft"}
                </button>
              </form>
            )}

            {listings.isLoading && <StatusBanner title="Loading your homes…" />}
            {listings.isError && <StatusBanner tone="claim" title="Could not load your homes" />}
            {listings.data?.length === 0 && !creating && (
              <StatusBanner
                title="No homes yet"
                detail="Add one and it starts as a draft — nobody can book it until you publish."
              />
            )}

            {listings.data?.map((listing: HostListing) => (
              <div
                key={listing.id}
                className="flex flex-col gap-3 rounded-card border border-linen-tint p-[18px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <Link to={`/host/listings/${listing.id}`} className="text-sm font-bold text-ink">
                      {listing.title || "Untitled home"}
                    </Link>
                    <span className="text-xs text-ink/55">
                      {listing.city}, {listing.country} · sleeps {listing.maxGuests}
                    </span>
                    <span className="money text-xs text-ink/70">
                      {formatUsd(listing.nightlyRateCents)} / night
                    </span>
                  </div>
                  <span className="text-[11.5px] font-bold tracking-[0.1em] text-ink/50">
                    {STATUS_LABEL[listing.status].toUpperCase()}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {listing.status !== "active" ? (
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: listing.id, status: "active" })}
                      className="rounded-full border border-spruce px-3 py-1.5 text-xs font-bold text-spruce"
                    >
                      Publish
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: listing.id, status: "paused" })}
                      className="rounded-full border border-linen-tint px-3 py-1.5 text-xs font-bold text-ink/70"
                    >
                      Take off the market
                    </button>
                  )}
                  <Link
                    to={`/host/listings/${listing.id}`}
                    className="rounded-full border border-linen-tint px-3 py-1.5 text-xs font-bold text-ink/70"
                  >
                    Edit and photos
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove.mutate(listing.id)}
                    className="rounded-full border border-claim/40 px-3 py-1.5 text-xs font-bold text-claim"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {remove.isError && (
              <StatusBanner
                tone="claim"
                title="Could not delete that home"
                detail={
                  remove.error instanceof ApiError
                    ? remove.error.message
                    : "Something went wrong. Try again."
                }
              />
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
