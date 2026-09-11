import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { BrandLockup } from "./BrandMark";

/**
 * Shared footer. Links only to routes that exist; no policy pages are
 * promised that the product does not have.
 */
export function SiteFooter() {
  const { user } = useAuth();
  return (
    <footer className="border-t border-divider bg-canvas">
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-5 py-8 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-16">
        <div className="flex flex-col gap-2">
          <Link to="/" className="inline-flex w-fit no-underline">
            <BrandLockup />
          </Link>
          <p className="m-0 text-sm text-ink-secondary">Homes for 30 nights or more.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
          <Link to="/explore" className="text-ink no-underline hover:text-brand">
            Find a home
          </Link>
          <Link to="/for-homeowners" className="text-ink no-underline hover:text-brand">
            For homeowners
          </Link>
          {user ? (
            <Link to="/host/listings" className="text-ink no-underline hover:text-brand">
              Your homes
            </Link>
          ) : (
            <Link to="/login" className="text-ink no-underline hover:text-brand">
              Sign in
            </Link>
          )}
        </nav>
        <p className="m-0 text-sm text-ink-secondary">Copyright 2026 Stead contributors</p>
      </div>
    </footer>
  );
}
