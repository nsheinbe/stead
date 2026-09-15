import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { HostSubnav } from "../components/HostSubnav";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  DataList,
  DataRow,
  ErrorSummary,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  StatusMessage,
  StatusPill,
  Surface,
  Textarea,
  TextInput,
  type FieldErrorItem,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { formatCoordinate, validateCoordinates } from "../lib/coordinates";
import { LOCATION_READOUT } from "../lib/honestyCopy";
import {
  diffListingInput,
  LISTING_FIELD_ORDER,
  listingFormFromDetail,
  listingFormToInput,
  type ListingFormErrors,
  type ListingFormField,
  type ListingFormValues,
} from "../lib/listingForm";
import { formatUsd, MIN_STAY_NIGHTS } from "../lib/money";
import { POLICY_LABEL, TYPE_LABEL, type ListingDetail, type ListingInput } from "../lib/types";
import { LISTING_WIZARD_STEPS } from "./HostStart";

/** DOM ids, so the error summary can move focus to the field it names. */
const FIELD_ID: Record<ListingFormField, string> = {
  title: "listing-title",
  description: "listing-description",
  type: "listing-type",
  addressLine: "listing-address",
  city: "listing-city",
  region: "listing-region",
  country: "listing-country",
  timezone: "listing-timezone",
  nightlyRate: "listing-nightly",
  deposit: "listing-deposit",
  maxGuests: "listing-guests",
  bedrooms: "listing-bedrooms",
  beds: "listing-beds",
  wifi: "listing-wifi",
  kitchen: "listing-kitchen",
  fireplace: "listing-fireplace",
  courtyard: "listing-courtyard",
  instantBook: "listing-instant-book",
  cancellationPolicy: "listing-policy",
};

function summaryErrors(errors: ListingFormErrors): FieldErrorItem[] {
  return LISTING_FIELD_ORDER.filter((field) => errors[field]).map((field) => ({
    fieldId: FIELD_ID[field],
    message: errors[field] as string,
  }));
}

const STATUS_LABEL: Record<ListingDetail["status"], string> = {
  draft: "Draft",
  active: "Listed",
  paused: "Paused",
};

/**
 * HM-01. The front door has its own small form, apart from the listing diff:
 * confirming is a recorded action that sends lat, lng and the confirmation in
 * one PATCH, and "Save changes" must never confirm a point by accident.
 */
type DoorForm = { lat: string; lng: string; confirm: boolean };
type DoorErrors = { lat?: string; lng?: string; confirm?: string };

const DOOR_NOT_SET = "Not set. Guests can't book a home without a confirmed location and a verified scan.";
const DOOR_MOVED =
  "Changing the location will need a new confirmation — and a new scan if one is verified.";
const DOOR_LOCATION_OFF = "Location: off. Allow location for this site, or type the coordinates.";
const DOOR_NO_FIX = "We couldn't get a fix from your phone. Try again outside, or type the coordinates.";

function doorFromListing(listing: ListingDetail): DoorForm {
  const c = listing.coordinates ?? null;
  return { lat: c ? formatCoordinate(c.lat) : "", lng: c ? formatCoordinate(c.lng) : "", confirm: false };
}

/**
 * Edit one home.
 *
 * Hydration reads `GET /api/listings/:id`, not the dashboard summary. The
 * summary carries seven fields; the detail carries all sixteen editable ones,
 * and the server already lets an owner read their own draft or paused home —
 * so this needed no new endpoint, only the right one.
 *
 * Saving sends the diff. A field the host did not touch is absent from the
 * PATCH body rather than resent, which is what keeps a stale read from
 * overwriting a value changed elsewhere.
 *
 * Ownership is checked here so the page does not offer controls that would
 * 404. It is not the enforcement: `listings_host_update` is, and the route
 * mirrors it.
 */
export function HostListingEditPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  // The last two groups of the creation wizard continue here, against a
  // listing that now exists. Outside setup this is just the editor.
  const setup = params.get("setup");
  const setupStep = setup === "photos" ? 4 : setup === "review" ? 5 : null;

  const [form, setForm] = useState<ListingFormValues | null>(null);
  const [baseline, setBaseline] = useState<ListingInput | null>(null);
  const [errors, setErrors] = useState<ListingFormErrors>({});
  const [saved, setSaved] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [door, setDoor] = useState<DoorForm | null>(null);
  const [doorErrors, setDoorErrors] = useState<DoorErrors>({});
  const [doorStatus, setDoorStatus] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const listingQuery = useQuery({
    queryKey: ["listing", listingId],
    enabled: Boolean(listingId) && status === "signed_in",
    queryFn: () => api.listing(listingId as string),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const listing = listingQuery.data;
  const isOwner = Boolean(listing?.host && user && listing.host.id === user.id);

  // The accuracy gate for "Use my location here" is the server's, read from
  // the same endpoint the capture page uses. The default only covers the
  // moment before it arrives.
  const scanStatus = useQuery({
    queryKey: ["listing-scan", listingId],
    enabled: Boolean(listingId) && isOwner,
    queryFn: () => api.listingScan(listingId as string),
  });
  const accuracyMaxM = scanStatus.data?.thresholds.accuracyMaxM ?? 35;

  // Seed once, and only from a listing this member owns. Later edits are not
  // clobbered by a background refetch.
  useEffect(() => {
    if (!listing || !isOwner || form !== null) return;
    const values = listingFormFromDetail(listing);
    const hydrated = listingFormToInput(values);
    setForm(values);
    setBaseline(hydrated.ok ? hydrated.input : null);
    setDoor(doorFromListing(listing));
  }, [listing, isOwner, form]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["listing", listingId] }),
      queryClient.invalidateQueries({ queryKey: ["host-listings", user?.id] }),
    ]);
  };

  const save = useMutation({
    mutationFn: (patch: Partial<ListingInput>) => api.updateListing(listingId as string, patch),
    onSuccess: async (_result, patch) => {
      // The baseline moves to what the server now holds, so a second save
      // sends only what changed after this one.
      setBaseline((previous) => (previous ? { ...previous, ...patch } : previous));
      setSaved(true);
      await invalidate();
    },
  });

  const publish = useMutation({
    mutationFn: (next: ListingDetail["status"]) => api.updateListing(listingId as string, { status: next }),
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
      setUploadError(err instanceof ApiError ? err.message : "That photo could not be uploaded.");
    },
  });

  const removePhoto = useMutation({
    mutationFn: (photoId: string) => api.deletePhoto(photoId),
    onSuccess: invalidate,
  });

  const confirmDoor = useMutation({
    mutationFn: (point: { lat: number; lng: number }) =>
      api.updateListing(listingId as string, { lat: point.lat, lng: point.lng, confirmCoordinates: true }),
    onSuccess: async (_result, point) => {
      setDoorErrors({});
      setDoorStatus(null);
      // Normalise what was typed to what was saved, so "42.25290" and the
      // server's 42.2529 read as the same, confirmed point.
      setDoor((previous) =>
        previous
          ? { ...previous, lat: formatCoordinate(point.lat), lng: formatCoordinate(point.lng), confirm: false }
          : previous,
      );
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["listing-scan", listingId] });
    },
  });

  function updateDoor<K extends keyof DoorForm>(field: K, value: DoorForm[K]) {
    setDoor((previous) => (previous ? { ...previous, [field]: value } : previous));
    setDoorErrors((previous) => {
      if (!previous[field as keyof DoorErrors]) return previous;
      const next = { ...previous };
      delete next[field as keyof DoorErrors];
      return next;
    });
  }

  function submitDoor() {
    if (!door) return;
    const result = validateCoordinates(door.lat, door.lng);
    const errors: DoorErrors = result.ok ? {} : { ...result.errors };
    if (!door.confirm) errors.confirm = "Tick the box to confirm this is the front door.";
    if (!result.ok || Object.keys(errors).length > 0) {
      setDoorErrors(errors);
      return;
    }
    setDoorErrors({});
    confirmDoor.mutate({ lat: result.lat, lng: result.lng });
  }

  /**
   * Fill the fields from the phone, only when the fix is within the accuracy
   * gate. A rough fix is reported, never written: the host can wait for a
   * better one or type the point. Nothing here confirms anything.
   */
  function locateFromPhone() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDoorStatus(DOOR_LOCATION_OFF);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const acc = position.coords.accuracy;
        if (acc <= accuracyMaxM) {
          setDoor((previous) =>
            previous
              ? {
                  ...previous,
                  lat: formatCoordinate(position.coords.latitude),
                  lng: formatCoordinate(position.coords.longitude),
                }
              : previous,
          );
          setDoorErrors({});
          setDoorStatus(`From your phone, about ${Math.max(5, Math.round(acc / 5) * 5)} m accuracy.`);
        } else {
          setDoorStatus(`${LOCATION_READOUT.rough(acc)} Or type the coordinates.`);
        }
      },
      (error) => {
        setLocating(false);
        setDoorStatus(error.code === error.PERMISSION_DENIED ? DOOR_LOCATION_OFF : DOOR_NO_FIX);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  function update<K extends ListingFormField>(field: K, value: ListingFormValues[K]) {
    setForm((previous) => (previous ? { ...previous, [field]: value } : previous));
    setSaved(false);
    // Clearing on edit keeps a corrected field from staying red.
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function submit() {
    if (!form || !baseline) return;
    const result = listingFormToInput(form);
    if (!result.ok) {
      setErrors(result.errors);
      setSaved(false);
      return;
    }
    setErrors({});
    const patch = diffListingInput(baseline, result.input);
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    save.mutate(patch);
  }

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" workspace="hosting" title="Edit your home">
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

  const notFound = listingQuery.error instanceof ApiError && listingQuery.error.status === 404;

  return (
    <Shell width="narrow" workspace="hosting" title="Edit your home" backTo="/host/listings" backLabel="Your homes">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <HostSubnav />

        {setupStep ? (
          <Progress steps={LISTING_WIZARD_STEPS} current={setupStep} label="Listing setup" />
        ) : null}

        {listingQuery.isPending ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            <p role="status" className="sr-only">
              Loading this home
            </p>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : notFound || !listing ? (
          <>
            <PageHeader
              title="We couldn't find this home."
              description="It may have been deleted, or the link may be out of date."
            />
            <ButtonLink to="/host/listings" className="self-start">
              Your homes
            </ButtonLink>
          </>
        ) : listingQuery.isError ? (
          <StatusMessage
            tone="danger"
            title="We couldn't load this home."
            action={
              <Button variant="secondary" size="sm" onClick={() => void listingQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : !isOwner ? (
          <>
            <PageHeader
              title="This home isn't yours to edit."
              description="Only the homeowner can change a listing. You can still view it as a guest would."
            />
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/listing/${listing.id}`}>View this home</ButtonLink>
              <ButtonLink to="/host/listings" variant="secondary">
                Your homes
              </ButtonLink>
            </div>
          </>
        ) : form ? (
          <>
            <div className="flex flex-col gap-3">
              <PageHeader
                title={listing.title || "Untitled home"}
                description="Changes save to this listing. Only the fields you edit are sent."
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={listing.status === "active" ? "brand" : "neutral"}>
                  {STATUS_LABEL[listing.status]}
                </StatusPill>
                <ButtonLink to={`/listing/${listing.id}`} variant="quiet" size="sm">
                  Preview as a guest
                </ButtonLink>
              </div>
            </div>

            {setupStep ? null : (
            <form
              className="flex flex-col gap-6"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <ErrorSummary errors={summaryErrors(errors)} />

              <Card as="section" aria-labelledby="basics-heading">
                <h2 id="basics-heading" className="m-0 text-card-title">
                  The home
                </h2>
                <div className="mt-4 flex flex-col gap-5">
                  <TextInput
                    id={FIELD_ID.title}
                    label="Name"
                    hint="What a guest will see first."
                    value={form.title}
                    error={errors.title}
                    onChange={(e) => update("title", e.target.value)}
                  />
                  <Textarea
                    id={FIELD_ID.description}
                    label="Description"
                    optional
                    rows={6}
                    value={form.description}
                    error={errors.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                  <Select
                    id={FIELD_ID.type}
                    label="Type of home"
                    value={form.type}
                    error={errors.type}
                    onChange={(e) => update("type", e.target.value as ListingFormValues["type"])}
                  >
                    {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((key) => (
                      <option key={key} value={key}>
                        {TYPE_LABEL[key]}
                      </option>
                    ))}
                  </Select>
                </div>
              </Card>

              <Card as="section" id="where" aria-labelledby="where-heading">
                <h2 id="where-heading" className="m-0 text-card-title">
                  Where it is
                </h2>
                <div className="mt-4 flex flex-col gap-5">
                  <TextInput
                    id={FIELD_ID.addressLine}
                    label="Street address"
                    optional
                    hint="Shared with a guest after a stay is confirmed, not on the public page."
                    value={form.addressLine}
                    error={errors.addressLine}
                    onChange={(e) => update("addressLine", e.target.value)}
                  />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextInput
                      id={FIELD_ID.city}
                      label="City"
                      value={form.city}
                      error={errors.city}
                      onChange={(e) => update("city", e.target.value)}
                    />
                    <TextInput
                      id={FIELD_ID.region}
                      label="State or region"
                      optional
                      value={form.region}
                      error={errors.region}
                      onChange={(e) => update("region", e.target.value)}
                    />
                    <TextInput
                      id={FIELD_ID.country}
                      label="Country"
                      hint="Two-letter code, such as US."
                      inputMode="text"
                      maxLength={2}
                      className="uppercase"
                      value={form.country}
                      error={errors.country}
                      onChange={(e) => update("country", e.target.value.toUpperCase())}
                    />
                    <TextInput
                      id={FIELD_ID.timezone}
                      label="Time zone"
                      hint="Check-in and checkout follow this zone, such as America/New_York."
                      value={form.timezone}
                      error={errors.timezone}
                      onChange={(e) => update("timezone", e.target.value)}
                    />
                  </div>
                </div>

                {door ? (
                  <FrontDoorSection
                    listing={listing}
                    door={door}
                    errors={doorErrors}
                    status={doorStatus}
                    locating={locating}
                    confirming={confirmDoor.isPending}
                    failure={
                      confirmDoor.isError
                        ? confirmDoor.error instanceof ApiError
                          ? confirmDoor.error.message
                          : "Nothing was changed. Please try again."
                        : null
                    }
                    onChange={updateDoor}
                    onUseMyLocation={locateFromPhone}
                    onConfirm={submitDoor}
                  />
                ) : null}
              </Card>

              <Card as="section" aria-labelledby="price-heading">
                <h2 id="price-heading" className="m-0 text-card-title">
                  Price and terms
                </h2>
                <div className="mt-4 flex flex-col gap-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextInput
                      id={FIELD_ID.nightlyRate}
                      label="Nightly rate"
                      hint="In US dollars. Guests are quoted this for every night of the stay."
                      inputMode="decimal"
                      className="money"
                      value={form.nightlyRate}
                      error={errors.nightlyRate}
                      onChange={(e) => update("nightlyRate", e.target.value)}
                    />
                    <TextInput
                      id={FIELD_ID.deposit}
                      label="Deposit"
                      hint="A maximum for damage claims, not a charge taken up front."
                      inputMode="decimal"
                      className="money"
                      value={form.deposit}
                      error={errors.deposit}
                      onChange={(e) => update("deposit", e.target.value)}
                    />
                  </div>
                  <Select
                    id={FIELD_ID.cancellationPolicy}
                    label="Cancellation policy"
                    value={form.cancellationPolicy}
                    error={errors.cancellationPolicy}
                    onChange={(e) =>
                      update("cancellationPolicy", e.target.value as ListingFormValues["cancellationPolicy"])
                    }
                  >
                    {(Object.keys(POLICY_LABEL) as (keyof typeof POLICY_LABEL)[]).map((key) => (
                      <option key={key} value={key}>
                        {POLICY_LABEL[key]}
                      </option>
                    ))}
                  </Select>
                  <Checkbox
                    id={FIELD_ID.instantBook}
                    label="Let guests book without asking first"
                    hint="A guest who meets your terms can reserve dates straight away."
                    checked={form.instantBook}
                    onChange={(e) => update("instantBook", e.target.checked)}
                  />
                </div>
              </Card>

              <Card as="section" aria-labelledby="whats-here-heading">
                <h2 id="whats-here-heading" className="m-0 text-card-title">
                  What's here
                </h2>
                <p className="m-0 mt-2 text-sm text-ink-secondary">
                  Left blank, these stay off the home's page rather than showing as a no.
                </p>
                <div className="mt-4 flex flex-col gap-5">
                  <div className="grid gap-5 sm:grid-cols-3">
                    <TextInput
                      id={FIELD_ID.maxGuests}
                      label="Sleeps"
                      inputMode="numeric"
                      value={form.maxGuests}
                      error={errors.maxGuests}
                      onChange={(e) => update("maxGuests", e.target.value)}
                    />
                    <TextInput
                      id={FIELD_ID.bedrooms}
                      label="Bedrooms"
                      optional
                      inputMode="numeric"
                      value={form.bedrooms}
                      error={errors.bedrooms}
                      onChange={(e) => update("bedrooms", e.target.value)}
                    />
                    <TextInput
                      id={FIELD_ID.beds}
                      label="Beds"
                      optional
                      inputMode="numeric"
                      value={form.beds}
                      error={errors.beds}
                      onChange={(e) => update("beds", e.target.value)}
                    />
                  </div>
                  <fieldset className="m-0 border-0 p-0">
                    <legend className="mb-2 text-sm font-semibold text-ink">Amenities</legend>
                    <div className="grid gap-1 sm:grid-cols-2">
                      <Checkbox
                        id={FIELD_ID.wifi}
                        label="Wi-Fi"
                        checked={form.wifi}
                        onChange={(e) => update("wifi", e.target.checked)}
                      />
                      <Checkbox
                        id={FIELD_ID.kitchen}
                        label="Kitchen"
                        checked={form.kitchen}
                        onChange={(e) => update("kitchen", e.target.checked)}
                      />
                      <Checkbox
                        id={FIELD_ID.fireplace}
                        label="Fireplace"
                        checked={form.fireplace}
                        onChange={(e) => update("fireplace", e.target.checked)}
                      />
                      <Checkbox
                        id={FIELD_ID.courtyard}
                        label="Courtyard"
                        checked={form.courtyard}
                        onChange={(e) => update("courtyard", e.target.checked)}
                      />
                    </div>
                  </fieldset>
                </div>
              </Card>

              {save.isError ? (
                <StatusMessage
                  tone="danger"
                  title="We couldn't save your changes."
                  action={
                    <Button variant="secondary" size="sm" onClick={submit}>
                      Try again
                    </Button>
                  }
                >
                  <p>
                    {save.error instanceof ApiError
                      ? save.error.message
                      : "Nothing was changed. Please try again."}
                  </p>
                </StatusMessage>
              ) : null}

              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" busy={save.isPending} busyLabel="Saving your changes…">
                  Save changes
                </Button>
                <p role="status" className="m-0 text-sm text-ink-secondary">
                  {saved && !save.isPending ? "Saved." : ""}
                </p>
              </div>
            </form>
            )}

            {setupStep === 5 ? null : (
            <section aria-labelledby="photos-heading" className="flex flex-col gap-4">
              <h2 id="photos-heading" className="m-0 text-card-title">
                Photos
              </h2>

              <div className="flex flex-col gap-2">
                <label htmlFor="listing-photo" className="text-sm font-semibold text-ink">
                  Add a photo
                </label>
                <input
                  ref={fileInput}
                  id="listing-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                  }}
                  className="text-sm"
                />
              </div>

              {upload.isPending ? <StatusMessage tone="info" title="Uploading your photo…" /> : null}
              {uploadError ? <StatusMessage tone="danger" title={uploadError} /> : null}

              {listing.photos.length === 0 ? (
                <StatusMessage tone="info" live={false} title="No photos yet.">
                  <p>A home with no photos is a hard sell. Add at least one before you list it.</p>
                </StatusMessage>
              ) : (
                <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-3">
                  {listing.photos.map((photo, index) => (
                    <li key={photo.id} className="flex flex-col gap-2">
                      <ListingPhoto src={photo.storagePath} alt="" className="rounded-card" />
                      <Button
                        variant="danger"
                        size="sm"
                        className="self-start"
                        busy={removePhoto.isPending && removePhoto.variables === photo.id}
                        onClick={() => removePhoto.mutate(photo.id)}
                      >
                        Remove photo {index + 1}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {removePhoto.isError ? (
                <StatusMessage tone="danger" title="We couldn't remove that photo. Please try again." />
              ) : null}

              {setupStep === 4 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => setParams({ setup: "review" }, { replace: true })}>
                    Continue to review
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => setParams({ setup: "review" }, { replace: true })}
                  >
                    Add photos later
                  </Button>
                </div>
              ) : null}
            </section>
            )}

            {setupStep === 5 ? (
              <ReviewStep
                listing={listing}
                publishing={publish.isPending}
                failed={publish.isError}
                onEdit={() => setParams({}, { replace: true })}
                onPublish={() => publish.mutate("active")}
                onFinishLater={() => navigate("/host/listings")}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </Shell>
  );
}

/**
 * The last group of the creation wizard.
 *
 * It reads the saved listing, not an unsaved local preview — so what a host
 * approves here is what the server holds. Publishing sets `status` to active
 * and nothing else: it makes the home bookable, which is not the same as being
 * able to be paid. That distinction is stated rather than smoothed over,
 * because a stay cannot charge without a Stripe payout account.
 */
function ReviewStep({
  listing,
  publishing,
  failed,
  onEdit,
  onPublish,
  onFinishLater,
}: {
  listing: ListingDetail;
  publishing: boolean;
  failed: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onFinishLater: () => void;
}) {
  const place = [listing.city, listing.region, listing.country].filter(Boolean).join(", ");
  const live = listing.status === "active";

  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-4">
      <h2 id="review-heading" className="m-0 text-card-title">
        Review
      </h2>

      {live ? (
        <StatusMessage tone="success" title="Your home is published.">
          <p>Guests can find it and request stays of {MIN_STAY_NIGHTS} nights or more.</p>
        </StatusMessage>
      ) : null}

      <Card>
        <DataList>
          <DataRow label="Name" value={listing.title || "Untitled home"} />
          <DataRow label="Type" value={TYPE_LABEL[listing.type]} />
          <DataRow label="Where" value={place} />
          <DataRow label="Time zone" value={listing.timezone} />
          <DataRow label="Sleeps" value={String(listing.maxGuests)} />
          <DataRow label="Nightly rate" value={formatUsd(listing.nightlyRateCents)} />
          <DataRow label="Deposit" value={formatUsd(listing.depositCents)} />
          <DataRow label="Cancellation" value={POLICY_LABEL[listing.cancellationPolicy]} />
          <DataRow label="Photos" value={String(listing.photos.length)} />
        </DataList>
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit these details
          </Button>
        </div>
      </Card>

      {listing.photos.length === 0 ? (
        <StatusMessage tone="warning" live={false} title="This home has no photos.">
          <p>You can publish without them, but a home with no photos is a hard sell.</p>
        </StatusMessage>
      ) : null}

      <Surface>
        <h3 className="m-0 text-base font-semibold">Payouts are separate from publishing</h3>
        <p className="mb-0 mt-2 text-sm text-ink-secondary">
          Publishing makes this home visible. A guest still cannot pay for a stay until Stripe has your
          payout account, and we never charge a guest into an account that isn't ready.
        </p>
        <div className="mt-4">
          <ButtonLink to="/host/payouts" variant="secondary" size="sm">
            Set up payouts
          </ButtonLink>
        </div>
      </Surface>

      {failed ? (
        <StatusMessage tone="danger" title="We couldn't publish this home.">
          <p>Nothing changed. Please try again.</p>
        </StatusMessage>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {live ? (
          <ButtonLink to={`/listing/${listing.id}`}>View your home</ButtonLink>
        ) : (
          <Button busy={publishing} busyLabel="Publishing your home…" onClick={onPublish}>
            Publish this home
          </Button>
        )}
        <Button variant="secondary" onClick={onFinishLater}>
          {live ? "Your homes" : "Keep it a draft"}
        </Button>
      </div>
    </section>
  );
}

/**
 * HM-01 — the front door (HM-D02).
 *
 * Its own form inside "Where it is": two decimal-degree fields, a button that
 * fills them from the phone only when the fix is within the gate, a checkbox
 * that says what the host is asserting, and the one button that records it.
 * The pill reads the server's `confirmedAt`; editing a field after a
 * confirmation shows what will happen, and the trigger in 0015 makes it so.
 */
function FrontDoorSection({
  listing,
  door,
  errors,
  status,
  locating,
  confirming,
  failure,
  onChange,
  onUseMyLocation,
  onConfirm,
}: {
  listing: ListingDetail;
  door: DoorForm;
  errors: DoorErrors;
  status: string | null;
  locating: boolean;
  confirming: boolean;
  failure: string | null;
  onChange: <K extends keyof DoorForm>(field: K, value: DoorForm[K]) => void;
  onUseMyLocation: () => void;
  onConfirm: () => void;
}) {
  const saved = listing.coordinates ?? null;
  const savedLat = saved ? formatCoordinate(saved.lat) : "";
  const savedLng = saved ? formatCoordinate(saved.lng) : "";
  const moved = door.lat.trim() !== savedLat || door.lng.trim() !== savedLng;
  const confirmedAt = saved?.confirmedAt ?? null;
  const confirmedOn = confirmedAt ? formatInTimeZone(confirmedAt, listing.timezone, "d MMM yyyy") : null;

  const line = !saved && !moved ? DOOR_NOT_SET : moved && confirmedAt ? DOOR_MOVED : null;

  return (
    <div className="mt-6 border-t border-divider pt-5">
      <h3 className="m-0 text-base font-semibold">Front door location</h3>
      <p className="mb-0 mt-1 text-sm text-ink-secondary">
        Your scan is checked against this point. Pick the front door, not the middle of the block.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmedOn && !moved ? (
          <StatusPill tone="brand" testId="door-confirmed">
            Confirmed {confirmedOn}
          </StatusPill>
        ) : saved && !moved ? (
          <StatusPill tone="warning">Needs confirmation</StatusPill>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div className="order-1 flex flex-wrap items-center gap-3 sm:order-2">
          <Button
            variant="secondary"
            size="sm"
            busy={locating}
            busyLabel="Finding your phone…"
            onClick={onUseMyLocation}
          >
            Use my location here
          </Button>
          <p role="status" className="m-0 text-sm text-ink-secondary">
            {status ?? line ?? ""}
          </p>
        </div>
        <div className="order-2 grid gap-5 sm:order-1 sm:grid-cols-2">
          <TextInput
            id="listing-lat"
            label="Latitude"
            hint="Decimal degrees, such as 45.5231"
            inputMode="decimal"
            autoComplete="off"
            value={door.lat}
            error={errors.lat}
            onChange={(e) => onChange("lat", e.target.value)}
          />
          <TextInput
            id="listing-lng"
            label="Longitude"
            hint="Decimal degrees, such as -122.6765"
            inputMode="decimal"
            autoComplete="off"
            value={door.lng}
            error={errors.lng}
            onChange={(e) => onChange("lng", e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4">
        <Checkbox
          id="listing-door-confirm"
          label="This is the front door of the home"
          hint="Confirming records that you checked this point."
          checked={door.confirm}
          error={errors.confirm}
          onChange={(e) => onChange("confirm", e.target.checked)}
        />
      </div>

      {failure ? (
        <div className="mt-4">
          <StatusMessage
            tone="danger"
            title="We couldn't confirm the location."
            action={
              <Button variant="secondary" size="sm" onClick={onConfirm}>
                Try again
              </Button>
            }
          >
            <p>{failure}</p>
          </StatusMessage>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" busy={confirming} busyLabel="Confirming…" onClick={onConfirm}>
          Confirm the home's location
        </Button>
        <p className="m-0 text-sm text-ink-secondary">
          Only you see these coordinates. Guests see the city and region, as they do today.
        </p>
      </div>
    </div>
  );
}

