import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { prettyRange } from "../lib/dates";
import { supabaseConfigured } from "../lib/env";
import { formatUsd } from "../lib/money";
import { getSupabase } from "../lib/supabase";
import { listingOf, type Booking } from "../lib/types";

const STATUS_LABEL: Record<Booking["status"], string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  checked_in: "In stay",
  completed: "Completed",
  canceled_by_guest: "Canceled",
  canceled_by_host: "Canceled by host",
  expired: "Expired hold",
};

export function TripsPage() {
  const configured = supabaseConfigured();
  const { user, loading } = useAuth();

  const trips = useQuery({
    queryKey: ["trips", user?.id],
    enabled: configured && Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from("bookings")
        .select("*, listings(*, listing_photos(*))")
        .eq("guest_id", user?.id)
        .order("check_in", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-3.5 px-[18px] pb-4 pt-16 md:pt-4">
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-2xl font-semibold">Your stays</h1>
        </div>

        {!configured ? (
          <StatusBanner title="Connect Supabase to see trips" />
        ) : loading ? (
          <StatusBanner title="Checking your session…" />
        ) : !user ? (
          <StatusBanner
            title="Sign in to see your trips"
            detail="Magic link only for now — Google sign-in is waiting on an OAuth client."
          />
        ) : null}

        {user && !configured ? null : user && trips.isLoading ? (
          <StatusBanner title="Loading trips…" />
        ) : null}
        {trips.isError ? (
          <StatusBanner
            tone="claim"
            title="Could not load trips"
            detail={trips.error instanceof Error ? trips.error.message : undefined}
          />
        ) : null}
        {user && trips.data && trips.data.length === 0 ? (
          <StatusBanner
            title="No trips yet"
            detail="Find a member home and request to book. Abandoned checkouts expire in 30 minutes so dates stay free."
          />
        ) : null}

        {user && !trips.data?.length && configured ? (
          <Link
            to="/explore"
            className="rounded-xl bg-spruce py-3.5 text-center text-sm font-bold text-paper no-underline hover:bg-spruce-deep hover:text-paper"
          >
            Find a stay
          </Link>
        ) : null}

        <div className="flex flex-col gap-3">
          {trips.data?.map((booking) => {
            const listing = listingOf(booking);
            const photos = [...(listing?.listing_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order);
            return (
              <Link
                key={booking.id}
                to={`/trips/${booking.id}`}
                className="flex items-center gap-3 rounded-[14px] border border-linen-tint px-3.5 py-3 text-inherit no-underline"
              >
                <div className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[10px] bg-linen">
                  {photos[0] ? (
                    <img src={photos[0].storage_path} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-bold">{listing?.title ?? "Stay"}</span>
                  <span className="text-xs text-ink/55">
                    {prettyRange(booking.check_in, booking.check_out)} · {listing?.city}
                  </span>
                  <span className="money text-xs font-semibold text-ink/70">
                    {STATUS_LABEL[booking.status]} · {formatUsd(booking.guest_total_cents)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
