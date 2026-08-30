export type ListingType = "entire_home" | "apartment" | "private_room";
export type CancellationPolicy = "flexible" | "moderate" | "strict";
export type ListingStatus = "draft" | "active" | "paused";
export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "canceled_by_guest"
  | "canceled_by_host"
  | "expired";

export type ListingAmenities = {
  bedrooms?: number;
  beds?: number;
  wifi?: boolean;
  kitchen?: boolean;
  fireplace?: boolean;
  courtyard?: boolean;
};

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_host: boolean;
};

export type ListingPhoto = {
  id: string;
  listing_id: string;
  storage_path: string;
  sort_order: number;
};

export type Listing = {
  id: string;
  host_id: string;
  title: string;
  description: string;
  type: ListingType;
  address_line: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  nightly_rate_cents: number;
  deposit_cents: number;
  max_guests: number;
  amenities: ListingAmenities;
  instant_book: boolean;
  cancellation_policy: CancellationPolicy;
  status: ListingStatus;
  listing_photos?: ListingPhoto[];
  profiles?: Profile | Profile[] | null;
};

export type Booking = {
  id: string;
  listing_id: string;
  guest_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  nights: number;
  nightly_rate_cents: number;
  stay_subtotal_cents: number;
  network_fee_cents: number;
  guest_total_cents: number;
  deposit_cents: number;
  cancellation_policy: CancellationPolicy;
  status: BookingStatus;
  created_at: string;
  listings?: Listing | Listing[] | null;
  escrow_deposits?: { amount_cents: number; state: string }[] | null;
};

export function hostOf(listing: Listing): Profile | null {
  const p = listing.profiles;
  if (!p) return null;
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

export function listingOf(booking: Booking): Listing | null {
  const l = booking.listings;
  if (!l) return null;
  return Array.isArray(l) ? (l[0] ?? null) : l;
}

export const TYPE_LABEL: Record<ListingType, string> = {
  entire_home: "Entire home",
  apartment: "Apartment",
  private_room: "Private room",
};

export const POLICY_LABEL: Record<CancellationPolicy, string> = {
  flexible: "Flexible cancel",
  moderate: "Moderate cancel",
  strict: "Strict cancel",
};
