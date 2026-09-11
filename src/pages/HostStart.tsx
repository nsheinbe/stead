import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  ErrorSummary,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  StatusMessage,
  Surface,
  Textarea,
  TextInput,
  type FieldErrorItem,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import { HOMEOWNER_CONTINUATION, loginHref } from "../lib/continuation";
import { clearHostPrecreateDraft, readHostPrecreateDraft, saveHostPrecreateDraft } from "../lib/drafts";
import {
  browserTimeZone,
  emptyListingForm,
  errorsForStep,
  listingFormToInput,
  type ListingFormErrors,
  type ListingFormField,
  type ListingFormValues,
  type ListingStepName,
} from "../lib/listingForm";
import { MIN_STAY_NIGHTS } from "../lib/money";
import { POLICY_LABEL, TYPE_LABEL } from "../lib/types";

export const LISTING_WIZARD_STEPS = ["Basics", "Home details", "Price and terms", "Photos", "Review"] as const;

/** DOM ids, so the error summary can move focus to the field it names. */
const FIELD_ID: Partial<Record<ListingFormField, string>> = {
  title: "new-title",
  description: "new-description",
  type: "new-type",
  addressLine: "new-address",
  city: "new-city",
  region: "new-region",
  country: "new-country",
  timezone: "new-timezone",
  nightlyRate: "new-nightly",
  deposit: "new-deposit",
  maxGuests: "new-guests",
  bedrooms: "new-bedrooms",
  beds: "new-beds",
  cancellationPolicy: "new-policy",
};

const ORDER: ListingFormField[] = [
  "title",
  "type",
  "city",
  "region",
  "country",
  "timezone",
  "maxGuests",
  "description",
  "addressLine",
  "bedrooms",
  "beds",
  "nightlyRate",
  "deposit",
  "cancellationPolicy",
];

function summaryErrors(errors: ListingFormErrors): FieldErrorItem[] {
  return ORDER.filter((field) => errors[field] && FIELD_ID[field]).map((field) => ({
    fieldId: FIELD_ID[field] as string,
    message: errors[field] as string,
  }));
}

const STEP_INDEX: Record<ListingStepName, number> = { basics: 1, details: 2, price: 3 };

/**
 * Listing creation (N02).
 *
 * `POST /api/listings` requires a complete listing — it is not a partial-draft
 * endpoint, and this wizard does not pretend otherwise. Nothing reaches the
 * server until the host has supplied every required field, and then it is sent
 * exactly once. Steps four and five continue in the editor against that real
 * listing id, because photos need a listing to attach to.
 *
 * Before that first save there is no server-side draft, so what this page
 * remembers on the device is only the non-sensitive essentials (INT-03): a
 * name, the kind of home, city, country, time zone and capacity. Rate, deposit,
 * address and description are never written to anonymous storage.
 */
export function HostStartPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<ListingStepName>("basics");
  const [form, setForm] = useState<ListingFormValues>(() => emptyListingForm(browserTimeZone()));
  const [errors, setErrors] = useState<ListingFormErrors>({});
  const [restored, setRestored] = useState<"restored" | "unavailable" | null>(null);
  const restoreAttempted = useRef(false);
  // A listing id, once one exists, is the record that this wizard already
  // created its draft. It is never allowed to create a second.
  const createdId = useRef<string | null>(null);

  useEffect(() => {
    if (restoreAttempted.current || status !== "signed_in") return;
    restoreAttempted.current = true;
    const result = readHostPrecreateDraft(user?.id ?? null);
    if (result.status === "unavailable") {
      setRestored("unavailable");
      return;
    }
    if (result.status !== "restored") return;
    const fields = result.draft.fields;
    if (Object.keys(fields).length === 0) return;
    setForm((current) => ({
      ...current,
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.type !== undefined ? { type: fields.type } : {}),
      ...(fields.city !== undefined ? { city: fields.city } : {}),
      ...(fields.country !== undefined ? { country: fields.country } : {}),
      ...(fields.timezone !== undefined ? { timezone: fields.timezone } : {}),
      ...(fields.maxGuests !== undefined ? { maxGuests: String(fields.maxGuests) } : {}),
    }));
    setRestored("restored");
  }, [status, user?.id]);

  /** Keep the essentials on this device. Money and free text stay out of it. */
  function remember(next: ListingFormValues) {
    const maxGuests = /^\d+$/.test(next.maxGuests.trim()) ? Number(next.maxGuests) : undefined;
    const saved = saveHostPrecreateDraft(
      {
        title: next.title || undefined,
        type: next.type,
        city: next.city || undefined,
        country: next.country || undefined,
        timezone: next.timezone || undefined,
        maxGuests,
      },
      user?.id ?? null,
    );
    if (!saved.ok) setRestored("unavailable");
  }

  function update<K extends ListingFormField>(field: K, value: ListingFormValues[K]) {
    setForm((previous) => {
      const next = { ...previous, [field]: value };
      if (step === "basics") remember(next);
      return next;
    });
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  const create = useMutation({
    mutationFn: (values: ListingFormValues) => {
      const result = listingFormToInput(values);
      if (!result.ok) throw new Error("The listing is not complete.");
      // Explicitly a draft. Nothing is publicly bookable until the host
      // publishes it from the review step.
      return api.createListing({ ...result.input, status: "draft" });
    },
    onSuccess: ({ id }) => {
      createdId.current = id;
      clearHostPrecreateDraft();
      // Replace, so Back does not return to a form that would create a second
      // listing.
      navigate(`/host/listings/${id}?setup=photos`, { replace: true });
    },
  });

  function advance(from: ListingStepName, to: ListingStepName) {
    const found = errorsForStep(form, from);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setStep(to);
  }

  function saveDraft() {
    if (createdId.current) {
      navigate(`/host/listings/${createdId.current}?setup=photos`, { replace: true });
      return;
    }
    const priceErrors = errorsForStep(form, "price");
    if (Object.keys(priceErrors).length > 0) {
      setErrors(priceErrors);
      return;
    }
    // The whole listing is checked here, not just this step: a required field
    // left behind in Basics must surface before the request, not as a 400.
    const complete = listingFormToInput(form);
    if (!complete.ok) {
      setErrors(complete.errors);
      setStep("basics");
      return;
    }
    setErrors({});
    create.mutate(form);
  }

  if (status === "loading") {
    return (
      <Shell width="narrow" title="Start your listing" workspace="hosting">
        <div className="py-8">
          <Card aria-busy="true">
            <p role="status" className="sr-only">
              Checking your session
            </p>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-6 h-12 w-48" />
          </Card>
        </div>
      </Shell>
    );
  }

  if (status !== "signed_in") {
    return (
      <Shell width="narrow" title="Start your listing" workspace="hosting">
        <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
          <PageHeader
            eyebrow="For homeowners"
            title="Start your listing"
            description={`Your home starts as a draft. You choose when to publish it. Stays are ${MIN_STAY_NIGHTS} nights or more.`}
          />
          <Card>
            <h2 className="m-0 text-card-title">Sign in to save your home as a draft.</h2>
            <p className="mb-0 mt-2 text-ink-secondary">
              One email link either creates your account or opens it. We'll bring you straight back here.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <ButtonLink
                to={loginHref({
                  next: HOMEOWNER_CONTINUATION,
                  intent: "homeowner",
                  source: "homeowner_hero",
                })}
              >
                Continue with your email
              </ButtonLink>
            </div>
          </Card>
          <Surface>
            <h2 className="m-0 text-card-title">What setup covers</h2>
            <ol className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
              {LISTING_WIZARD_STEPS.map((title, index) => (
                <li key={title} className="flex gap-4">
                  <span className="money mt-0.5 text-sm font-semibold text-ink-secondary">0{index + 1}</span>
                  <span className="font-semibold">{title}</span>
                </li>
              ))}
            </ol>
            <p className="mb-0 mt-5 text-sm text-ink-secondary">
              Payout setup must be complete before a guest can pay for a stay. A published home and a
              payment-ready account are separate things, and we show them separately.
            </p>
          </Surface>
        </div>
      </Shell>
    );
  }

  return (
    <Shell width="narrow" title="Start your listing" workspace="hosting">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        <PageHeader
          eyebrow="For homeowners"
          title="Start your listing"
          description="Nothing is public until you publish it."
        />
        <Progress steps={LISTING_WIZARD_STEPS} current={STEP_INDEX[step]} label="Listing setup" />

        {restored === "restored" ? (
          <StatusMessage
            tone="success"
            title="We brought back what you'd started."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  clearHostPrecreateDraft();
                  setRestored(null);
                  setForm(emptyListingForm(browserTimeZone()));
                }}
              >
                Start over
              </Button>
            }
          >
            <p>
              This home isn't saved to your account yet. Check the details, and it saves when you reach
              Price and terms.
            </p>
          </StatusMessage>
        ) : null}

        {restored === "unavailable" ? (
          <StatusMessage tone="warning" title="Your entries couldn't be saved on this device.">
            <p>You can still finish and save. Leaving this page may mean starting again.</p>
          </StatusMessage>
        ) : null}

        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "basics") advance("basics", "details");
            else if (step === "details") advance("details", "price");
            else saveDraft();
          }}
        >
          <ErrorSummary errors={summaryErrors(errors)} />

          {step === "basics" ? (
            <Card as="section" aria-labelledby="basics-heading">
              <h2 id="basics-heading" className="m-0 text-card-title">
                Basics
              </h2>
              <div className="mt-4 flex flex-col gap-5">
                <TextInput
                  id={FIELD_ID.title}
                  label="Name of the home"
                  hint="What a guest sees first, such as “The Gatehouse”."
                  value={form.title}
                  error={errors.title}
                  onChange={(e) => update("title", e.target.value)}
                />
                <Select
                  id={FIELD_ID.type}
                  label="Type of home"
                  value={form.type}
                  onChange={(e) => update("type", e.target.value as ListingFormValues["type"])}
                >
                  {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((key) => (
                    <option key={key} value={key}>
                      {TYPE_LABEL[key]}
                    </option>
                  ))}
                </Select>
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
                    maxLength={2}
                    className="uppercase"
                    value={form.country}
                    error={errors.country}
                    onChange={(e) => update("country", e.target.value.toUpperCase())}
                  />
                  <TextInput
                    id={FIELD_ID.maxGuests}
                    label="Sleeps"
                    inputMode="numeric"
                    value={form.maxGuests}
                    error={errors.maxGuests}
                    onChange={(e) => update("maxGuests", e.target.value)}
                  />
                </div>
                <TextInput
                  id={FIELD_ID.timezone}
                  label="Time zone"
                  hint="We've suggested your browser's zone. Change it if the home is somewhere else — check-in and checkout run on this clock."
                  value={form.timezone}
                  error={errors.timezone}
                  onChange={(e) => update("timezone", e.target.value)}
                />
              </div>
            </Card>
          ) : null}

          {step === "details" ? (
            <Card as="section" aria-labelledby="details-heading">
              <h2 id="details-heading" className="m-0 text-card-title">
                Home details
              </h2>
              <p className="m-0 mt-2 text-sm text-ink-secondary">
                All optional. You can skip this and add it later.
              </p>
              <div className="mt-4 flex flex-col gap-5">
                <Textarea
                  id={FIELD_ID.description}
                  label="Description"
                  optional
                  rows={6}
                  hint="What the home is like, and what a long stay there feels like."
                  value={form.description}
                  error={errors.description}
                  onChange={(e) => update("description", e.target.value)}
                />
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
                  <p className="m-0 mb-2 text-sm text-ink-secondary">
                    Left unticked, these stay off the home's page rather than showing as a no.
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <Checkbox label="Wi-Fi" checked={form.wifi} onChange={(e) => update("wifi", e.target.checked)} />
                    <Checkbox
                      label="Kitchen"
                      checked={form.kitchen}
                      onChange={(e) => update("kitchen", e.target.checked)}
                    />
                    <Checkbox
                      label="Fireplace"
                      checked={form.fireplace}
                      onChange={(e) => update("fireplace", e.target.checked)}
                    />
                    <Checkbox
                      label="Courtyard"
                      checked={form.courtyard}
                      onChange={(e) => update("courtyard", e.target.checked)}
                    />
                  </div>
                </fieldset>
              </div>
            </Card>
          ) : null}

          {step === "price" ? (
            <Card as="section" aria-labelledby="price-heading">
              <h2 id="price-heading" className="m-0 text-card-title">
                Price and terms
              </h2>
              <div className="mt-4 flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextInput
                    id={FIELD_ID.nightlyRate}
                    label="Nightly rate"
                    hint="In US dollars. A guest is quoted this for every night of the stay."
                    inputMode="decimal"
                    className="money"
                    value={form.nightlyRate}
                    error={errors.nightlyRate}
                    onChange={(e) => update("nightlyRate", e.target.value)}
                  />
                  <TextInput
                    id={FIELD_ID.deposit}
                    label="Deposit"
                    hint="A maximum for damage claims, not a charge taken up front. Enter 0 for none."
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
                  label="Let guests book without asking first"
                  hint="A guest who meets your terms can reserve dates straight away."
                  checked={form.instantBook}
                  onChange={(e) => update("instantBook", e.target.checked)}
                />
              </div>
            </Card>
          ) : null}

          {create.isError ? (
            <StatusMessage tone="danger" title="We couldn't save your home.">
              <p>
                {create.error instanceof ApiError
                  ? create.error.message
                  : "Nothing was saved. Please try again."}
              </p>
            </StatusMessage>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {step !== "basics" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(step === "price" ? "details" : "basics")}
              >
                Back
              </Button>
            ) : null}

            {step === "price" ? (
              <Button type="submit" busy={create.isPending} busyLabel="Saving your draft…">
                Save draft and add photos
              </Button>
            ) : (
              <Button type="submit">Continue</Button>
            )}

            {step === "details" ? (
              <Button type="button" variant="quiet" onClick={() => advance("details", "price")}>
                Skip this
              </Button>
            ) : null}
          </div>

          <p className="m-0 text-sm text-ink-secondary">
            {step === "price"
              ? "This saves your home as a draft, so photos have somewhere to attach. It stays private until you publish it."
              : "Nothing is saved to your account until you reach Price and terms."}
          </p>
        </form>
      </div>
    </Shell>
  );
}
