import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import type { HostListing, ListingInput } from "../lib/types";

type Editable = Pick<
  ListingInput,
  "title" | "city" | "country" | "timezone" | "nightlyRateCents" | "depositCents" | "maxGuests"
>;

function toEditable(listing: HostListing): Editable {
  return {
    title: listing.title,
    city: listing.city,
    country: listing.country,
    timezone: listing.timezone,
    nightlyRateCents: listing.nightlyRateCents,
    depositCents: listing.depositCents,
    maxGuests: listing.maxGuests,
  };
}

export function HostListingEditPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const listings = useQuery({
    queryKey: ["host-listings", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.hostListings(),
  });

  const listing = listings.data?.find((row) => row.id === listingId);

  // Seed the form once the listing arrives, without clobbering later edits.
  useEffect(() => {
    if (listing && form === null) setForm(toEditable(listing));
  }, [listing, form]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["host-listings", user?.id] });

  const save = useMutation({
    mutationFn: (patch: Editable) => api.updateListing(listingId as string, patch),
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // Presign, PUT straight to the bucket, then record it. The API never
      // sees the bytes.
      const presigned = await api.photoUploadUrl(listingId as string, file.type);
      await api.uploadToBucket(presigned.uploadUrl, file);
      await api.attachPhoto(listingId as string, presigned.key);
    },
    onSuccess: async () => {
      setUploadError(null);
      if (fileInput.current) fileInput.current.value = "";
      await invalidate();
    },
    onError: (err) => {
      setUploadError(
        err instanceof ApiError ? err.message : "That photo could not be uploaded.",
      );
    },
  });

  const removePhoto = useMutation({
    mutationFn: (photoId: string) => api.deletePhoto(photoId),
    onSuccess: invalidate,
  });

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" workspace="hosting">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to edit this home"
            description="Only the homeowner can open this listing. We'll bring you back here."
            intent="homeowner"
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        <HostSubnav />
        <Link to="/host/listings" className="text-xs font-bold text-ink/55">
          ← Your homes
        </Link>

        {listings.isLoading && <StatusBanner title="Loading…" />}
        {listings.isError && <StatusBanner tone="claim" title="Could not load this home" />}
        {listings.data && !listing && (
          <StatusBanner title="No home here" detail="It may have been deleted." />
        )}

        {listing && form && (
          <>
            <h1 className="m-0 font-display text-2xl font-semibold">{listing.title || "Untitled home"}</h1>

            <form
              className="flex flex-col gap-3 rounded-card border border-linen-tint p-[18px]"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                TITLE
                <input
                  required
                  minLength={3}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink/60">
                  CITY
                  <input
                    required
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs font-bold text-ink/60">
                  COUNTRY
                  <input
                    required
                    maxLength={2}
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal uppercase text-ink"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
                TIME ZONE
                <input
                  required
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink/60">
                  NIGHTLY (USD)
                  <input
                    type="number"
                    min={1}
                    value={form.nightlyRateCents / 100}
                    onChange={(e) =>
                      setForm({ ...form, nightlyRateCents: Math.round(Number(e.target.value) * 100) })
                    }
                    className="money rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-ink/60">
                  DEPOSIT (USD)
                  <input
                    type="number"
                    min={0}
                    value={form.depositCents / 100}
                    onChange={(e) =>
                      setForm({ ...form, depositCents: Math.round(Number(e.target.value) * 100) })
                    }
                    className="money rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs font-bold text-ink/60">
                  SLEEPS
                  <input
                    type="number"
                    min={1}
                    value={form.maxGuests}
                    onChange={(e) => setForm({ ...form, maxGuests: Number(e.target.value) })}
                    className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
                  />
                </label>
              </div>
              {save.isError && (
                <StatusBanner
                  tone="claim"
                  title="Could not save"
                  detail={save.error instanceof ApiError ? save.error.message : "Try again."}
                />
              )}
              <button
                type="submit"
                disabled={save.isPending}
                className="self-start rounded-full bg-spruce px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
            </form>

            <h2 className="m-0 mt-2 font-display text-lg font-semibold">Photos</h2>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
              className="text-sm"
            />
            {upload.isPending && <StatusBanner title="Uploading…" />}
            {uploadError && <StatusBanner tone="claim" title="Upload failed" detail={uploadError} />}
            {listing.photos.length === 0 && (
              <StatusBanner
                title="No photos yet"
                detail="A home without photos is a hard sell."
              />
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {listing.photos.map((photo) => (
                <div key={photo.id} className="flex flex-col gap-1">
                  <img
                    src={photo.storagePath}
                    alt=""
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-card object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto.mutate(photo.id)}
                    className="self-start text-xs font-bold text-claim"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
