import { Shell } from "../components/Shell";
import { ButtonLink, Card, PageHeader, Skeleton, Surface } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { HOMEOWNER_CONTINUATION, loginHref } from "../lib/continuation";
import { MIN_STAY_NIGHTS } from "../lib/money";

const GROUPS = [
  { title: "Basics", body: "Title, home type, city, country, the home's time zone and how many guests it welcomes." },
  { title: "Home details", body: "A description and the amenities you offer. You can skip this and add it later." },
  { title: "Price & policy", body: "Your nightly rate, deposit amount and cancellation policy. Then your draft is saved." },
  { title: "Photos", body: "Add photos of the actual home to the saved draft." },
  { title: "Review", body: "Check everything, set up payouts with Stripe, and publish when you're ready." },
] as const;

/**
 * Canonical entry to listing creation (N02). This first version establishes
 * the route and its sign-in continuation; HOST-02 replaces the body with the
 * five-group wizard. Signed in, it hands over to the existing create form.
 */
export function HostStartPage() {
  const { user, loading } = useAuth();
  const signInHref = loginHref({ next: HOMEOWNER_CONTINUATION, intent: "homeowner", source: "homeowner_hero" });

  return (
    <Shell width="narrow" title="Start your listing" workspace="hosting">
      <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
        <PageHeader
          eyebrow="For homeowners"
          title="Start your listing"
          description={`Your home starts as a draft. You choose when to publish it. Stays are ${MIN_STAY_NIGHTS} nights or more.`}
        />

        {loading ? (
          <Card aria-busy="true">
            <p role="status" className="sr-only">
              Checking your session
            </p>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-6 h-12 w-48" />
          </Card>
        ) : !user ? (
          <Card>
            <h2 className="m-0 text-card-title">Create an account or sign in to save your home as a draft.</h2>
            <p className="mb-0 mt-2 text-ink-secondary">
              One email link either creates your account or opens it. We'll bring you straight back here.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <ButtonLink to={signInHref}>Continue with your email</ButtonLink>
            </div>
          </Card>
        ) : (
          <Card>
            <h2 className="m-0 text-card-title">Save the essentials now. Add photos and details next.</h2>
            <p className="mb-0 mt-2 text-ink-secondary">
              Nothing is public until you publish. Your draft saves when you choose to save it.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <ButtonLink to="/host/listings?create=1">Add a home</ButtonLink>
              <ButtonLink to="/host/listings" variant="secondary">
                Your homes
              </ButtonLink>
            </div>
          </Card>
        )}

        <Surface>
          <h2 className="m-0 text-card-title">What the setup covers</h2>
          <ol className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
            {GROUPS.map((group, index) => (
              <li key={group.title} className="flex gap-4">
                <span className="money mt-0.5 text-sm font-semibold text-ink-secondary">0{index + 1}</span>
                <div>
                  <h3 className="m-0 text-base font-semibold">{group.title}</h3>
                  <p className="m-0 text-sm text-ink-secondary">{group.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mb-0 mt-5 text-sm text-ink-secondary">
            Payout setup must be complete before guests can pay for a stay. A live listing and a payment-ready
            account are shown separately.
          </p>
        </Surface>
      </div>
    </Shell>
  );
}
