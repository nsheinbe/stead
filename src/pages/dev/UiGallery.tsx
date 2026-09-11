import { useState } from "react";
import { Shell } from "../../components/Shell";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  DataList,
  DataRow,
  Dialog,
  EmptyState,
  ErrorSummary,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  SkeletonText,
  StatusMessage,
  StatusPill,
  Surface,
  Textarea,
  TextInput,
} from "../../components/ui";

/**
 * Development-only state gallery for the shared system (UI-01 evidence).
 * Registered at /_ui by App.tsx only when import.meta.env.DEV is true.
 */
const SWATCHES = [
  ["canvas", "#FFFFFF", "bg-canvas border border-divider"],
  ["surface", "#F5F7F6", "bg-surface"],
  ["surface-accent", "#E9F1EC", "bg-surface-accent"],
  ["ink", "#17201B", "bg-ink"],
  ["ink-secondary", "#53625A", "bg-ink-secondary"],
  ["brand", "#1E4034", "bg-brand"],
  ["brand-hover", "#16332A", "bg-brand-hover"],
  ["divider", "#DCE2DE", "bg-divider"],
  ["control", "#88968F", "bg-control"],
  ["focus", "#276A52", "bg-focus"],
  ["danger", "#A73528", "bg-danger"],
  ["danger-surface", "#FAEBE8", "bg-danger-surface"],
  ["warning", "#78520B", "bg-warning"],
  ["warning-surface", "#FFF1DD", "bg-warning-surface"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-divider pt-8">
      <h2 className="m-0 text-card-title">{title}</h2>
      {children}
    </section>
  );
}

export default function UiGalleryPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  return (
    <Shell title="UI gallery (development)">
      <div className="flex flex-col gap-10 py-8">
        <PageHeader
          eyebrow="Development only"
          title="Shared system"
          description="Every component in every state. This route does not exist in a production build."
          actions={<StatusPill tone="warning">Not a product screen</StatusPill>}
        />

        <Section title="Colour tokens">
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4 lg:grid-cols-7">
            {SWATCHES.map(([name, hex, cls]) => (
              <li key={name} className="flex flex-col gap-1.5 text-xs">
                <span className={`h-12 rounded-control ${cls}`} aria-hidden />
                <span className="font-semibold">{name}</span>
                <span className="money text-ink-secondary">{hex}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Type scale">
          <p className="m-0 text-hero-sm sm:text-hero-lg">A home for your next chapter.</p>
          <p className="m-0 text-page-title">Page title 40px</p>
          <p className="m-0 text-section-title">Section title 32px</p>
          <p className="m-0 text-card-title">Card title 20px</p>
          <p className="m-0 text-body-lg">Body large 18px — for introductions and descriptions.</p>
          <p className="m-0 text-body">Body 16px — the reading size for everything else.</p>
          <p className="m-0 text-label font-semibold">Label 14px semibold</p>
          <p className="m-0 text-metadata text-ink-secondary">Metadata 12px — never for instructions.</p>
          <p className="money m-0 text-[2rem] font-semibold">$3,672 <span className="text-base font-normal text-ink-secondary">for 30 nights</span></p>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Confirm cancellation</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
            <Button busy={busy} busyLabel="Sending your link…" onClick={() => setBusy(true)}>
              Send sign-in link
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setBusy(false)}>
              Reset busy
            </Button>
            <ButtonLink to="/explore" variant="secondary">
              Link as button
            </ButtonLink>
          </div>
          <Button block>Full width</Button>
        </Section>

        <Section title="Fields">
          <div className="grid gap-5 md:grid-cols-2">
            <TextInput label="Email address" type="email" autoComplete="email" placeholder="you@example.com" />
            <TextInput label="Nightly rate (USD)" inputMode="decimal" hint="Whole dollars or dollars and cents." />
            <TextInput label="City" defaultValue="Hudson" error="Enter the city where the home is." />
            <TextInput label="Disabled" disabled defaultValue="Read only" />
            <Select label="Home type" hint="Use the home's time zone, even if you're somewhere else.">
              <option>Entire home</option>
              <option>Apartment</option>
              <option>Private room</option>
            </Select>
            <Select label="Cancellation policy" optional error="Choose a policy.">
              <option value="">Choose…</option>
              <option>Flexible</option>
            </Select>
            <Textarea label="About your home" optional wrapperClassName="md:col-span-2" />
            <Checkbox label="Allow instant booking" hint="Guests can confirm without waiting." />
            <Checkbox type="radio" name="r" label="Accept the claim" error="Choose one option." />
          </div>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setShowErrors(true)}>
              Show submit-time error summary
            </Button>
          </div>
          {showErrors ? (
            <ErrorSummary errors={[{ fieldId: "missing-field", message: "Enter the city where the home is." }]} />
          ) : null}
        </Section>

        <Section title="Status messages">
          <StatusMessage title="Draft saved." live={false}>
            <p>Add photos now, or come back when you're ready.</p>
          </StatusMessage>
          <StatusMessage tone="success" title="Your stay is confirmed." live={false} action={<Button size="sm">Message host</Button>} />
          <StatusMessage tone="warning" title="Your listing is live, but guests can't pay until payout setup is complete." live={false} />
          <StatusMessage tone="danger" title="Payment wasn't completed." live={false}>
            <p>Review the payment details and try again.</p>
          </StatusMessage>
        </Section>

        <Section title="Status pills">
          <div className="flex flex-wrap gap-2">
            <StatusPill>Draft</StatusPill>
            <StatusPill tone="brand">Live</StatusPill>
            <StatusPill tone="success">Confirmed</StatusPill>
            <StatusPill tone="warning">Payment pending</StatusPill>
            <StatusPill tone="danger">Disputed</StatusPill>
          </div>
        </Section>

        <Section title="Surfaces and data rows">
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <h3 className="m-0 text-card-title">Card</h3>
              <DataList className="mt-3">
                <DataRow label="30 nights × $120" value="$3,600" />
                <DataRow label="Guest network fee (2%)" value="$72" />
                <DataRow label="Estimated stay total" value="$3,672" total />
              </DataList>
            </Card>
            <Surface>
              <h3 className="m-0 text-card-title">Surface</h3>
              <DataList className="mt-3">
                <DataRow label="Deposit arrangement" value="$300" hint="Separate from your stay charge." />
              </DataList>
            </Surface>
          </div>
        </Section>

        <Section title="Progress">
          <Progress steps={["Your stay", "Price & terms", "Payment"]} current={2} label="Booking progress" />
        </Section>

        <Section title="Loading and empty">
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <Skeleton className="mb-4 aspect-[4/3] w-full" />
              <SkeletonText />
            </Card>
            <EmptyState
              title="Your next stay starts here."
              action={<ButtonLink to="/explore">Find a home</ButtonLink>}
            >
              <p>Find a home for 30 nights or more.</p>
            </EmptyState>
          </div>
        </Section>

        <Section title="Dialog">
          <div>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Review cancellation
            </Button>
          </div>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Review your cancellation"
            description="The amounts below come from the server's preview."
          >
            <DataList>
              <DataRow label="Refund amount" value="$3,672" />
              <DataRow label="Deposit release amount" value="$300" />
            </DataList>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="danger" onClick={() => setDialogOpen(false)}>
                Confirm cancellation
              </Button>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Keep this stay
              </Button>
            </div>
          </Dialog>
        </Section>
      </div>
    </Shell>
  );
}
