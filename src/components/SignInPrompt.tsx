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
 */
export function SignInPrompt({
  title,
  description,
  intent,
  source = "protected_deep_link",
  action = "Continue with your email",
}: {
  title: string;
  description?: string;
  intent?: Intent;
  source?: Source;
  action?: string;
}) {
  const location = useLocation();
  const { status, refetch } = useAuth();
  const next = `${location.pathname}${location.search}`;

  if (status === "loading") {
    return (
      <Card aria-busy="true">
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
    );
  }

  return (
    <Card>
      <h2 className="m-0 text-card-title">{title}</h2>
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
