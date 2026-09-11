import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import {
  Button,
  ButtonLink,
  Card,
  PageHeader,
  Skeleton,
  StatusMessage,
  Surface,
  TextInput,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import {
  continuationLabel,
  DEFAULT_CONTINUATION,
  normalizeContinuation,
  parseLoginContext,
  type LoginContext,
} from "../lib/continuation";
import { prettyRange } from "../lib/dates";
import { readBookingDraft, type BookingSelectionDraft } from "../lib/drafts";
import { clearLoginContext, readLoginContext, saveLoginContext } from "../lib/loginContext";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Kind = "generic" | "booking" | "homeowner" | "conversation";

function kindOf(context: LoginContext): Kind {
  if (context.intent === "homeowner" || context.next.startsWith("/host/")) return "homeowner";
  if (context.next.startsWith("/book/")) return "booking";
  if (context.next.startsWith("/messages/")) return "conversation";
  return "generic";
}

const COPY: Record<Kind, { heading: string; description: string }> = {
  generic: {
    heading: "Welcome to Stead",
    description: "Enter your email to create an account or sign in. We'll send you a link.",
  },
  booking: {
    heading: "Continue with your email",
    description: "We'll bring you back to review this stay.",
  },
  homeowner: {
    heading: "Start your listing",
    description: "Create an account or sign in to save your home as a draft.",
  },
  conversation: {
    heading: "Continue with your email",
    description: "We'll bring you back to your conversation.",
  },
};

/**
 * Auth.js appends `?error=<code>` when a link cannot be used. The codes are
 * mapped to bounded member-facing copy; nothing internal is echoed.
 */
function authErrorCopy(code: string | null): { tone: "warning" | "danger"; text: string } | null {
  if (!code) return null;
  switch (code) {
    case "Verification":
      return { tone: "warning", text: "This link has expired or is no longer valid. Send a new link to continue." };
    case "Configuration":
      return { tone: "danger", text: "Sign-in isn't available right now. Please try again shortly." };
    default:
      return { tone: "warning", text: "We couldn't sign you in with that link. Send a new link to continue." };
  }
}

/** The stay a renter was about to book: listing id and draft pointer from the destination. */
function bookingRef(next: string): { listingId: string; draftId: string | null } | null {
  const match = /^\/book\/([A-Za-z0-9-]{1,64})(?:\?(.*))?$/.exec(next);
  if (!match) return null;
  const draftId = match[2] ? new URLSearchParams(match[2]).get("draft") : null;
  return { listingId: match[1] as string, draftId };
}

export function LoginPage() {
  const session = useAuth();
  const [params] = useSearchParams();

  // The URL wins; an expired-link return (no `next`) falls back to what this
  // device remembered when the link was sent.
  const context = useMemo<LoginContext>(() => {
    const fromUrl = parseLoginContext(params);
    if (params.has("next") || params.has("intent")) return fromUrl;
    return readLoginContext() ?? fromUrl;
  }, [params]);
  const kind = kindOf(context);
  const copy = COPY[kind];
  const authError = authErrorCopy(params.get("error"));

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"form" | "sent">(params.get("sent") === "1" ? "sent" : "form");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase === "sent") sentHeadingRef.current?.focus();
  }, [phase]);

  async function send(target: string) {
    const trimmed = target.trim();
    if (!EMAIL.test(trimmed)) {
      setFieldError("Enter a valid email address.");
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    setSendError(null);
    setBusy(true);
    try {
      const next = normalizeContinuation(context.next, kind === "homeowner" ? "/host/start" : DEFAULT_CONTINUATION);
      await api.sendSignInLink(trimmed, `${window.location.origin}${next}`);
      saveLoginContext({ ...context, next });
      setSentTo(trimmed);
      setPhase("sent");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setSendError(
        status === 429
          ? "Too many sign-in links were requested. Wait a few minutes and try again."
          : "We couldn't send the link. Check your email address and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell focused width="reading" title="Sign in">
      <div className="flex flex-1 flex-col gap-8 py-10 sm:py-14">
        {session.status === "loading" ? (
          <div aria-busy="true">
            <p role="status" className="sr-only">
              Checking whether you're signed in
            </p>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="mt-3 h-5 w-full" />
            <Skeleton className="mt-8 h-12 w-full" />
          </div>
        ) : session.status === "signed_in" && session.user ? (
          <>
            <PageHeader title="You're signed in." description={`Signed in as ${session.user.email}.`} />
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={context.next} onClick={() => clearLoginContext()}>
                {continuationLabel(context.next)}
              </ButtonLink>
              <ButtonLink to="/explore" variant="secondary">
                Find a home
              </ButtonLink>
            </div>
          </>
        ) : phase === "sent" ? (
          <>
            <div className="flex flex-col gap-3">
              <h1 ref={sentHeadingRef} tabIndex={-1} className="m-0 text-[2rem] sm:text-page-title">
                Check your email
              </h1>
              <p role="status" className="m-0 text-body-lg text-ink-secondary">
                {sentTo ? (
                  <>
                    We sent a sign-in link to <span className="font-semibold text-ink">{sentTo}</span>. Open it to
                    continue.
                  </>
                ) : (
                  "We sent a sign-in link to your email address. Open it to continue."
                )}
              </p>
              <p className="m-0 text-ink-secondary">Check your spam folder if it hasn't arrived.</p>
              {kind === "booking" ? (
                <p className="m-0 text-ink-secondary">
                  To keep your selected dates, open the link in this browser. Nothing is reserved until you complete
                  payment.
                </p>
              ) : null}
            </div>
            {sendError ? <StatusMessage tone="danger" title={sendError} /> : null}
            <div className="flex flex-wrap gap-3">
              {sentTo ? (
                <Button variant="secondary" busy={busy} busyLabel="Sending your link…" onClick={() => void send(sentTo)}>
                  Send another link
                </Button>
              ) : null}
              <Button
                variant="quiet"
                onClick={() => {
                  setPhase("form");
                  setSendError(null);
                }}
              >
                Change email
              </Button>
            </div>
          </>
        ) : (
          <>
            <PageHeader
              eyebrow={kind === "homeowner" ? "For homeowners" : undefined}
              title={copy.heading}
              description={copy.description}
            />
            {session.status === "error" ? (
              <StatusMessage
                tone="danger"
                title="We couldn't check whether you're signed in."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
                    Try again
                  </Button>
                }
              >
                <p>You can still request a sign-in link.</p>
              </StatusMessage>
            ) : null}
            {authError ? <StatusMessage tone={authError.tone} title={authError.text} /> : null}
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void send(email);
              }}
            >
              <TextInput
                ref={inputRef}
                id="login-email"
                label="Email address"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                error={fieldError}
                hint="One link either creates your account or opens it. No password."
              />
              {sendError ? <StatusMessage tone="danger" title={sendError} /> : null}
              <Button type="submit" block busy={busy} busyLabel="Sending your link…">
                Send sign-in link
              </Button>
            </form>
            <LoginContextPanel kind={kind} next={context.next} viewerId={null} />
            <p className="m-0 text-sm text-ink-secondary">
              You can{" "}
              <Link to="/explore" className="font-semibold">
                browse homes
              </Link>{" "}
              without signing in.
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

/** What signing in leads to, in the member's terms. */
function LoginContextPanel({ kind, next, viewerId }: { kind: Kind; next: string; viewerId: string | null }) {
  if (kind === "homeowner") {
    return (
      <Surface padding="sm">
        <p className="m-0 text-sm font-semibold">Your home starts as a draft.</p>
        <p className="m-0 mt-1 text-sm text-ink-secondary">
          You choose when to publish it. After you sign in we'll take you straight to the listing setup.
        </p>
      </Surface>
    );
  }
  if (kind === "booking") {
    const ref = bookingRef(next);
    if (!ref) return null;
    return <BookingContext listingId={ref.listingId} draftId={ref.draftId} viewerId={viewerId} />;
  }
  if (kind === "conversation") {
    return (
      <Surface padding="sm">
        <p className="m-0 text-sm text-ink-secondary">
          After you sign in, you'll land in the conversation with this home's host. Nothing is sent until you write
          and send a message.
        </p>
      </Surface>
    );
  }
  return null;
}

function BookingContext({
  listingId,
  draftId,
  viewerId,
}: {
  listingId: string;
  draftId: string | null;
  viewerId: string | null;
}) {
  const [draft] = useState<BookingSelectionDraft | null>(() => {
    if (!draftId) return null;
    const result = readBookingDraft(draftId, viewerId);
    return result.status === "restored" ? result.draft : null;
  });
  const listing = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => api.listing(listingId),
    retry: false,
  });

  return (
    <Card padding="sm">
      <p className="m-0 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">Your stay</p>
      <p className="m-0 mt-1 text-base font-semibold">
        {listing.data?.title ?? (listing.isError ? "This home" : "Loading the home…")}
      </p>
      {draft ? (
        <p className="m-0 mt-1 text-sm text-ink-secondary">
          {prettyRange(draft.checkIn, draft.checkOut)} · {draft.guests} {draft.guests === 1 ? "guest" : "guests"}
        </p>
      ) : (
        <p className="m-0 mt-1 text-sm text-ink-secondary">
          Your selected dates are saved in the browser where you started. After you sign in you can choose dates
          again.
        </p>
      )}
      <p className="m-0 mt-2 text-sm text-ink-secondary">
        Nothing is reserved yet. You'll review the exact price before anything is charged.
      </p>
    </Card>
  );
}
