import { useQuery } from "@tanstack/react-query";
import { ListingCard } from "../components/ListingCard";
import { SearchIcon } from "../components/Icons";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { supabaseConfigured } from "../lib/env";
import { getSupabase } from "../lib/supabase";
import type { Listing } from "../lib/types";

export function ExplorePage() {
  const configured = supabaseConfigured();
  const listings = useQuery({
    queryKey: ["listings", "active"],
    enabled: configured,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from("listings")
        .select("*, listing_photos(*)")
        .eq("status", "active")
        .order("nightly_rate_cents", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Listing[];
    },
  });

  return (
    <Shell>
      <div className="flex flex-1 flex-col gap-4 px-[18px] pb-4 pt-16 md:pt-4">
        <div className="flex items-center gap-3 rounded-full bg-linen px-[18px] py-[13px]">
          <SearchIcon className="h-[19px] w-[19px] text-spruce" />
          <div className="flex flex-col">
            <span className="text-[15.5px] font-bold">Where to?</span>
            <span className="text-xs text-ink/55">Member homes · any week</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink/55">
            {listings.data
              ? `${listings.data.length} member ${listings.data.length === 1 ? "home" : "homes"}`
              : "Member homes"}
          </span>
          <div className="flex rounded-full bg-linen p-[3px]">
            <span className="rounded-full bg-paper px-4 py-[7px] text-[12.5px] font-bold shadow-[0_1px_3px_rgba(23,32,27,.12)]">
              List
            </span>
            <span className="px-4 py-[7px] text-[12.5px] font-semibold text-ink/55">Map</span>
          </div>
        </div>

        {!configured ? (
          <StatusBanner
            title="Connect Supabase to load stays"
            detail="Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. The live project is stead-dev in us-east-1."
          />
        ) : null}
        {listings.isLoading ? (
          <StatusBanner title="Loading member homes…" detail="Fetching active listings." />
        ) : null}
        {listings.isError ? (
          <StatusBanner
            tone="claim"
            title="Could not load listings"
            detail={listings.error instanceof Error ? listings.error.message : "Try again shortly."}
          />
        ) : null}
        {listings.data && listings.data.length === 0 ? (
          <StatusBanner
            title="No homes yet"
            detail="Run the seed on a fresh project — one host, six listings across timezones."
          />
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {listings.data?.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </div>
    </Shell>
  );
}
