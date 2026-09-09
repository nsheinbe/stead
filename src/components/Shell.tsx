import { Link } from "react-router-dom";
import { useAuth, useSignOut } from "../hooks/useAuth";
import { BrandMark } from "./BrandMark";
import { BottomNav } from "./BottomNav";
import { SkipLink } from "./SkipLink";

export function Shell({
  children,
  hideNav = false,
}: {
  children: React.ReactNode;
  hideNav?: boolean;
}) {
  const { user, isOps } = useAuth();
  const signOut = useSignOut();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SkipLink />
      <header className="hidden items-center justify-between border-b border-[#EEE7D8] bg-paper px-8 py-5 md:flex lg:px-16">
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <BrandMark />
          <span className="font-display text-[27px] font-bold tracking-tight text-ink">Stead</span>
        </Link>
        <div className="flex items-center gap-6 text-[15.5px] font-semibold text-ink/70">
          <Link to="/explore" className="no-underline hover:text-brass">
            Find a stay
          </Link>
          <Link to="/trips" className="no-underline hover:text-brass">
            Trips
          </Link>
          {user ? (
            <Link to={`/passport/${user.id}`} className="no-underline hover:text-brass">
              Passport
            </Link>
          ) : null}
          {isOps ? (
            <Link to="/ops" className="no-underline hover:text-brass">
              Ops
            </Link>
          ) : null}
          {user ? (
            <button
              type="button"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              className="font-semibold text-ink/70 hover:text-brass"
            >
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </button>
          ) : (
            <Link to="/login" className="no-underline hover:text-brass">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <div className="mx-auto flex min-h-screen max-w-[720px] flex-col md:min-h-0 md:max-w-5xl md:px-6 md:py-8">
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        {hideNav ? null : <BottomNav />}
      </div>
    </div>
  );
}
