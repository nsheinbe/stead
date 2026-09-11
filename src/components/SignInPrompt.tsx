import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { loginHref, type Intent, type Source } from "../lib/continuation";
import { Button, ButtonLink, Card, Skeleton, StatusMessage } from "./ui";

/**
 * The one way a protected screen asks for a session.
 *
 * It distinguishes the three states `useAuth` reports so a failed session
 * check is never rendered as "signed out": a member whose /api/me request
 * timed out is offered Retry, not a sign-in form that would throw away what
 * they were doing. The sign-in link always carries this exact route, so the
 * email link comes back here rather than to a generic destination.
 *
 * The title is the page's `h1` in every state, including while the session is
 * still being checked. On a protected route this component *is* the page, so
 * without it the page has no top-level heading — which leaves the shell's
 * route-change focus with nothing to land on and makes the page impossible to
 * orient in by heading. Pages that already own an `h1` pass `as="h2"`.
 */
export function SignInPrompt({
  title,
  description,
  intent,
  source = "protected_deep_link",
  action = "Continue with your email",
  as: Heading = "h1",
}: {
  title: string;
  description?: string;
  intent?: Intent;
  source?: Source;
  action?: string;
  /** "h2" when the surrounding page already has its own h1. */
  as?: "h1" | "h2";
}) {
  const location = useLocation();
  const { status, refetch } = useAuth();
  const next = `${location.pathname}${location.search}`;

  if (status === "loading") {
    return (
      <Card aria-busy="true">
        {/* Visually the skeleton stands in for the heading, but the heading
            itself still has to exist for the page to have one. */}
        <Heading className="sr-only">{title}</Heading>
        <p role="status" className="sr-only">
          Checking your session
        </p>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="mt-3 h-4 w-3/4" />
        <Skeleton className="mt-6 h-12 w-52" />
      </Card>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <Heading className="sr-only">{title}</Heading>
        <StatusMessage
          tone="danger"
          title="We couldn't check whether you're signed in."
          action={
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        >
          <p>This is a connection problem, not a sign-out. Nothing has changed.</p>
        </StatusMessage>
      </div>
    );
  }

  return (
    <Card>
      <Heading className="m-0 text-card-title">{title}</Heading>
      {description ? <p className="mb-0 mt-2 text-ink-secondary">{description}</p> : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink to={loginHref({ next, intent, source })}>{action}</ButtonLink>
        <ButtonLink to="/explore" variant="secondary">
          Find a home
        </ButtonLink>
      </div>
    </Card>
  );
}
