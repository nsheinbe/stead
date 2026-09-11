import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ListingCard, ListingCardSkeleton } from "../components/ListingCard";
import { Shell } from "../components/Shell";
import { Button, ButtonLink, Card, DataList, DataRow, StatusMessage, Surface, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { estimateMinimumStay } from "../lib/estimate";
import { feePercent } from "../lib/fees";
import { listingFiltersToSearch } from "../lib/filters";
import { formatUsd, MIN_STAY_NIGHTS } from "../lib/money";

/** The rate the worked example uses. Labelled as an example, never as a listing. */
const EXAMPLE_RATE_CENTS = 12_000;

const STEPS = [
  {
    title: "Find a home",
    body: `Search by place and party size. Every stay on Stead is ${MIN_STAY_NIGHTS} nights or more.`,
  },
  {
    title: "See the whole price",
    body: "The nightly rate, the guest network fee and the deposit arrangement are shown before you pay.",
  },
  {
    title: "Book your stay",
    body: "Choose your dates, review the exact amount from us, and message your host.",
  },
] as const;

const FAQ = [
  {
    q: "How long are stays on Stead?",
    a: `Every stay is at least ${MIN_STAY_NIGHTS} nights. You choose exact dates on a home's page, and the price you review is for those dates.`,
  },
  {
    q: "What is the guest network fee?",
    a: "It is a percentage of the stay price, added on top of the nightly rate and shown as its own line before you pay. Payment processing and any applicable taxes are separate considerations.",
  },
  {
    q: "What about the deposit?",
    a: "Each home sets a deposit amount. It is separate from your stay charge and is not collected when you pay. Your home's page explains how it is handled before you book.",
  },
  {
    q: "Can I rent a home and host with the same account?",
    a: "Yes. Renting and hosting are things you do, not a permanent choice. One account covers both.",
  },
] as const;

export function LandingPage() {
  const navigate = useNavigate();
  const [where, setWhere] = useState("");
  const [guests, setGuests] = useState("");

  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });
  const listings = useQuery({ queryKey: ["listings", "active"], queryFn: () => api.listings() });

  const feeBps = config.data?.networkFeeBps ?? null;
  const example = estimateMinimumStay(EXAMPLE_RATE_CENTS, feeBps);
  const preview = listings.data?.slice(0, 3) ?? [];

  function search(event: React.FormEvent) {
    event.preventDefault();
    const parsedGuests = Number.parseInt(guests, 10);
    const query = listingFiltersToSearch({
      q: where.trim() || undefined,
      guests: Number.isInteger(parsedGuests) && parsedGuests >= 1 ? parsedGuests : undefined,
    });
    navigate(query ? `/explore?${query}` : "/explore");
  }

  return (
    <Shell width="full" title="Homes for 30 nights or more">
      {/* --- hero ------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-content px-5 pb-12 pt-10 sm:px-8 sm:pt-14 lg:px-16 lg:pb-16 lg:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-6">
            <p className="m-0 text-metadata font-bold uppercase tracking-[0.16em] text-ink-secondary">
              Homes for {MIN_STAY_NIGHTS} nights or more
            </p>
            <h1 className="m-0 max-w-[13ch] text-hero-sm sm:text-page-title-lg lg:text-[4.5rem] lg:leading-[1.02] lg:tracking-[-0.045em]">
              A home for your next chapter.
            </h1>
            <p className="m-0 max-w-reading text-body-lg text-ink-secondary">
              Find a place to settle in. Compare homes, understand the price and choose your stay.
            </p>

            <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Find a home">
              <TextInput
                label="Where would you like to stay?"
                name="q"
                type="search"
                autoComplete="off"
                placeholder="City or region"
                value={where}
                onChange={(event) => setWhere(event.target.value)}
                wrapperClassName="flex-1"
              />
              <TextInput
                label="Guests"
                name="guests"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                placeholder="Any"
                value={guests}
                onChange={(event) => setGuests(event.target.value)}
                wrapperClassName="sm:w-28"
              />
              <Button type="submit" className="sm:mb-0">
                Find a home
              </Button>
            </form>

            <p className="m-0 text-sm text-ink-secondary">
              Browse without an account.{" "}
              <Link to="/for-homeowners" className="font-semibold">
                Have a home to share? List your home
              </Link>
            </p>
          </div>

          <div className="lg:justify-self-end">
            <div className="overflow-hidden rounded-surface bg-surface lg:rounded-[4px_80px_4px_4px]">
              <div className="flex aspect-[3/2] items-center justify-center px-8">
                <p className="m-0 max-w-[28ch] text-center text-body-lg text-ink-secondary">
                  Homes on Stead are photographed by the people who own them.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- real inventory --------------------------------------------- */}
      <section className="border-t border-divider" aria-labelledby="homes-heading">
        <div className="mx-auto w-full max-w-content px-5 py-12 sm:px-8 lg:px-16 lg:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="homes-heading" className="m-0 text-[1.75rem] sm:text-section-title">
              Homes on Stead right now.
            </h2>
            <ButtonLink to="/explore" variant="secondary">
              See all homes
            </ButtonLink>
          </div>

          <div className="mt-8">
            {listings.isPending ? (
              <>
                <p role="status" className="sr-only">
                  Loading homes
                </p>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  <ListingCardSkeleton />
                  <ListingCardSkeleton />
                  <ListingCardSkeleton />
                </div>
              </>
            ) : listings.isError ? (
              <StatusMessage
                tone="warning"
                title="We couldn't load homes just now."
                action={
                  <ButtonLink to="/explore" variant="secondary" size="sm">
                    Try browsing homes
                  </ButtonLink>
                }
              />
            ) : preview.length === 0 ? (
              <Surface>
                <h3 className="m-0 text-card-title">No homes are listed right now.</h3>
                <p className="mb-0 mt-2 max-w-reading text-ink-secondary">
                  Check back for new homes. If you have a place to share, you can create a listing today.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <ButtonLink to="/for-homeowners">List your home</ButtonLink>
                </div>
              </Surface>
            ) : (
              <ul className="m-0 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {preview.map((listing, index) => (
                  <li key={listing.id}>
                    <ListingCard listing={listing} networkFeeBps={feeBps} priority={index === 0} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* --- how it works ----------------------------------------------- */}
      <section className="border-t border-divider bg-surface" aria-labelledby="how-heading">
        <div className="mx-auto w-full max-w-content px-5 py-12 sm:px-8 lg:px-16 lg:py-16">
          <h2 id="how-heading" className="m-0 text-[1.75rem] sm:text-section-title">
            How a stay works.
          </h2>
          <ol className="m-0 mt-8 grid list-none gap-4 p-0 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <p className="money m-0 text-sm font-semibold text-ink-secondary">0{index + 1}</p>
                  <h3 className="mb-2 mt-2 text-card-title">{step.title}</h3>
                  <p className="m-0 text-ink-secondary">{step.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --- price --------------------------------------------------------- */}
      <section className="border-t border-divider" aria-labelledby="price-heading">
        <div className="mx-auto grid w-full max-w-content gap-10 px-5 py-12 sm:px-8 lg:grid-cols-2 lg:items-center lg:px-16 lg:py-16">
          <div className="flex flex-col gap-4">
            <h2 id="price-heading" className="m-0 text-[1.75rem] sm:text-section-title">
              See how the price adds up.
            </h2>
            {feeBps === null ? (
              <p className="m-0 max-w-reading text-body-lg text-ink-secondary">
                Your stay price, the guest network fee and the deposit arrangement are each shown as their own line
                before you pay.
              </p>
            ) : (
              <p className="m-0 max-w-reading text-body-lg text-ink-secondary">
                Stead's guest network fee is {feePercent(feeBps)} of the stay price. Deposit arrangements, payment
                processing and any applicable taxes are separate considerations.
              </p>
            )}
            <p className="m-0 max-w-reading text-ink-secondary">
              You see the exact amount for your dates, from us, before anything is charged.
            </p>
          </div>

          <Surface padding="lg">
            <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">
              An example, not a listing
            </p>
            <h3 className="mb-4 mt-2 text-card-title">
              A {MIN_STAY_NIGHTS}-night stay at {formatUsd(EXAMPLE_RATE_CENTS)} a night
            </h3>
            {example ? (
              <DataList>
                <DataRow
                  label={`${example.nights} nights × ${formatUsd(EXAMPLE_RATE_CENTS)}`}
                  value={formatUsd(example.staySubtotalCents)}
                />
                <DataRow
                  label={`Guest network fee (${feePercent(example.networkFeeBps)})`}
                  value={formatUsd(example.networkFeeCents)}
                />
                <DataRow label="Stay total" value={formatUsd(example.guestTotalCents)} total />
              </DataList>
            ) : (
              <p className="m-0 text-ink-secondary">
                The fee is a percentage of the stay price and appears as its own line at checkout.
              </p>
            )}
            <p className="mb-0 mt-4 text-sm text-ink-secondary">
              A worked example at an example rate. Your price depends on the home and your dates, and the deposit
              arrangement is separate from this total.
            </p>
          </Surface>
        </div>
      </section>

      {/* --- homeowners ---------------------------------------------------- */}
      <section className="border-t border-divider bg-surface" aria-labelledby="host-heading">
        <div className="mx-auto grid w-full max-w-content gap-6 px-5 py-12 sm:px-8 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:px-16 lg:py-16">
          <div className="flex flex-col gap-4">
            <h2 id="host-heading" className="m-0 text-[1.75rem] sm:text-section-title">
              Have a home to share?
            </h2>
            <p className="m-0 max-w-reading text-body-lg text-ink-secondary">
              Create your listing, set your rate and help renters find a home for {MIN_STAY_NIGHTS} nights or more.
              Your home starts as a draft. You choose when to publish it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <ButtonLink to="/for-homeowners">List your home</ButtonLink>
            <ButtonLink to="/host/start" variant="secondary">
              Start your listing
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* --- faq ------------------------------------------------------------ */}
      <section className="border-t border-divider" aria-labelledby="faq-heading">
        <div className="mx-auto w-full max-w-content px-5 py-12 sm:px-8 lg:px-16 lg:py-16">
          <h2 id="faq-heading" className="m-0 text-[1.75rem] sm:text-section-title">
            Good questions.
          </h2>
          <div className="mt-6 max-w-[760px]">
            {FAQ.map((item) => (
              <details key={item.q} className="border-b border-divider py-5">
                <summary className="flex min-h-[44px] items-center justify-between gap-6 text-lg font-semibold">
                  {item.q}
                  <span aria-hidden className="text-ink-secondary">
                    +
                  </span>
                </summary>
                <p className="mb-0 mt-3 text-ink-secondary">{item.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10">
            <ButtonLink to="/explore">Find a home</ButtonLink>
          </div>
        </div>
      </section>
    </Shell>
  );
}
