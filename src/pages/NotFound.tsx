import { useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Button, ButtonLink, PageHeader } from "../components/ui";
import { useAuth } from "../hooks/useAuth";

/**
 * Deliberate not-found view for unknown paths. The requested path is not
 * rendered or fetched; resource-specific "not found" states stay on their
 * own screens.
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canGoBack = typeof window !== "undefined" && window.history.length > 1;

  return (
    <Shell width="narrow" title="Page not found">
      <div className="flex flex-1 flex-col gap-8 py-12 sm:py-16">
        <PageHeader
          title="We couldn't find that page."
          description="The link may be out of date, or the page may have moved. Pick up from one of these instead."
        />
        <div className="flex flex-wrap gap-3">
          {canGoBack ? (
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Go back
            </Button>
          ) : null}
          <ButtonLink to="/explore">Find a home</ButtonLink>
          {user ? (
            <ButtonLink to="/host/listings" variant="secondary">
              Your homes
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
