import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ButtonLink, Card, Surface } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { formatUsd, MIN_STAY_NIGHTS, quoteStay } from "../lib/money";

const STEPS = [
  {
    title: "Add your home",
    body: "Start with the essentials, then add photos and details.",
  },
  {
    title: "Get ready for bookings",
    body: "Review your price and policy, and set up payouts with Stripe.",
  },
  {
    title: "Publish when you're ready",
    body: "Check your saved listing before it goes live.",
  },
] as const;

const FAQ = [
  {
    q: "How long are stays on Stead?",
    a: `Every stay is at least ${MIN_STAY_NIGHTS} nights. Renters choose their exact dates on your home's page, and the platform minimum applies to every listing.`,
  },
  {
    q: "Do I have to finish my listing in one sitting?",
    a: "No. Your home starts as a draft that only you can see. Add photos and details when you have them, and publish when you're ready.",
  },
  {
    q: "When can a renter pay for a stay?",
    a: "Payout setup must be complete before guests can pay for a stay. A listing can be live before that, so we show payout readiness separately from your listing's status.",
  },
  {
    q: "Can I rent a home and host with the same account?",
    a: "Yes. One account covers both. Renting and hosting are things you do, not a permanent choice about who you are.",
  },
] as const;

const EXAMPLE_RATE_CENTS = 12_000;

/**
 * Homeowner acquisition page (N01). Static explanation of the listing path
 * with the guest fee read from config; no earnings claims, no lead form.
 */
export function ForHomeownersPage() {
  const { user } = useAuth();
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.config() });
  const feeBps = config.data?.networkFeeBps;
  const feePercent = feeBps === undefined ? null : (feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const example =
    feeBps === undefined
      ? null
      : quoteStay({ nightlyRateCents: EXAMPLE_RATE_CENTS, nights: MIN_STAY_NIGHTS, networkFeeBps: feeBps, depositCents: 0 });

  return (
    <Shell width="full" title="For homeowners">
      <section className="mx-auto w-full max-w-content px-5 pb-12 pt-10 sm:px-8 sm:pt-14 lg:px-16 lg:pb-16 lg:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-6">
            <p className="m-0 text-metadata font-bold uppercase tracking-[0.16em] text-ink-secondary">For homeowners</p>
            <h1 className="m-0 max-w-[14ch] text-hero-sm sm:text-page-title-lg lg:text-[4.25rem] lg:leading-[1.02] lg:tracking-[-0.045em]">
              A clearer way to host longer stays.
            </h1>
            <p className="m-0 max-w-reading text-body-lg text-ink-secondary">
              Create your listing, set your rate and help renters find a home for {MIN_STAY_NIGHTS} nights or more.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink to="/host/start">Start your listing</ButtonLink>
              <a
                href="#how-it-works"
                className="inline-flex min-h-control items-center rounded-control px-3 text-[0.9375rem] font-semibold text-brand no-underline hover:bg-surface"
              >
                See how it works
              </a>
            </div>
            <p className="m-0 text-sm text-ink-secondary">
              Your home starts as a draft. You choose when to publish it.
              {user ? (
                <>
                  {" "}
                  Already hosting?{" "}
                  <Link to="/host/listings" className="font-semibold">
                    Go to your homes
                  </Link>
                  .
                </>
              ) : null}
            </p>
          </div>
          <Surface padding="lg" className="lg:justify-self-end lg:w-full lg:max-w-[480px]">
            <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">See how the price adds up</p>
            <h2 className="mb-4 mt-2 text-card-title">What a renter sees for a {MIN_STAY_NIGHTS}-night stay</h2>
            {example && feePercent !== null ? (
              <dl className="m-0">
                <div className="flex justify-between gap-4 border-b border-divider py-3">
                  <dt className="text-ink-secondary">
                    Example rate · {formatUsd(EXAMPLE_RATE_CENTS)} × {MIN_STAY_NIGHTS} nights
                  </dt>
                  <dd className="money m-0 font-semibold">{formatUsd(example.stay_subtotal_cents)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-divider py-3">
                  <dt className="text-ink-secondary">Guest network fee ({feePercent}%)</dt>
                  <dd className="money m-0 font-semibold">{formatUsd(example.network_fee_cents)}</dd>
                </div>
                <div className="flex justify-between gap-4 pt-3 text-lg font-semibold">
                  <dt>Renter's stay total</dt>
                  <dd className="money m-0">{formatUsd(example.guest_total_cents)}</dd>
                </div>
              </dl>
            ) : (
              <p className="m-0 text-ink-secondary">
                The guest network fee is a percentage of the stay price and is shown to renters before they pay.
              </p>
            )}
            <p className="mb-0 mt-4 text-sm text-ink-secondary">
              An illustration of Stead's guest network fee on an example rate, not an estimate of what reaches your
              bank. Deposit arrangements, payment processing and any applicable taxes are separate considerations.
            </p>
          </Surface>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-divider bg-surface" aria-labelledby="how-heading">
        <div className="mx-auto w-full max-w-content px-5 py-12 sm:px-8 lg:px-16 lg:py-16">
          <h2 id="how-heading" className="m-0 text-[1.75rem] sm:text-section-title">
            From your home to a complete listing.
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
          <p className="mb-0 mt-6 max-w-reading text-ink-secondary">
            Payout setup must be complete before guests can pay for a stay. Stripe collects the details needed for
            your payout account; we show that readiness separately from whether your listing is live.
          </p>
        </div>
      </section>

      <section aria-labelledby="faq-heading">
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
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <ButtonLink to="/host/start">Start your listing</ButtonLink>
            <ButtonLink to="/explore" variant="secondary">
              Find a home instead
            </ButtonLink>
          </div>
        </div>
      </section>
    </Shell>
  );
}
