import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useSignOut } from "../hooks/useAuth";
import { api } from "../lib/api";
import { loginHref } from "../lib/continuation";
import { documentTitle, isMemberRoute, routeMeta, type Workspace } from "../lib/routes";
import { BrandLockup } from "./BrandMark";
import { BottomNav } from "./BottomNav";
import { BackChevron, ChevronDownIcon, MenuIcon } from "./Icons";
import { SiteFooter } from "./SiteFooter";
import { SkipLink } from "./SkipLink";
import { Button, ButtonLink, Container, Dialog, type ContainerWidth } from "./ui";

type NavItem = { to: string; label: string; badge?: number };

type SessionView = {
  user: { id: string; email: string; name: string | null } | null;
  isOps: boolean;
  loading: boolean;
};

/**
 * Page chrome for every route. Public, renter and hosting navigation share
 * one header; which set shows is a display preference derived from the route
 * (or forced by `workspace`), never a permission. `focused` flows (sign-in,
 * checkout, editing, a conversation) drop the footer and the mobile bottom
 * navigation so nothing competes with the step's action.
 */
export function Shell({
  children,
  focused = false,
  hideNav = false,
  workspace = "auto",
  width = "wide",
  title,
  backTo,
  backLabel = "Back",
}: {
  children: ReactNode;
  focused?: boolean;
  /** @deprecated alias for `focused`, kept while screens migrate. */
  hideNav?: boolean;
  workspace?: Workspace | "auto";
  width?: ContainerWidth;
  /** Overrides the route table's document title. */
  title?: string;
  /** Mobile back link for focused flows that have no in-page Back control. */
  backTo?: string;
  backLabel?: string;
}) {
  const location = useLocation();
  const session = useAuth();
  const meta = routeMeta(location.pathname);
  const isFocused = focused || hideNav;
  const activeWorkspace: Workspace = workspace === "auto" ? meta.workspace : workspace;
  const resolvedTitle = title ?? meta.title;

  useEffect(() => {
    document.title = documentTitle(resolvedTitle);
  }, [resolvedTitle]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <SkipLink />
      <SiteHeader
        session={session}
        workspace={activeWorkspace}
        focused={isFocused}
        backTo={backTo}
        backLabel={backLabel}
        current={`${location.pathname}${location.search}`}
      />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <Container width={width} className="flex flex-1 flex-col">
          {children}
        </Container>
      </main>
      {isFocused ? null : <SiteFooter />}
      {isFocused ? null : <BottomNav />}
    </div>
  );
}

function useUnreadCount(userId: string | undefined): number {
  const unread = useQuery({
    queryKey: ["unread", userId],
    enabled: Boolean(userId),
    queryFn: () => api.unreadCount(),
    staleTime: 15_000,
  });
  return unread.data?.unread ?? 0;
}

function primaryNav(session: SessionView, workspace: Workspace, unread: number): NavItem[] {
  if (!session.user) {
    return [
      { to: "/explore", label: "Find a home" },
      { to: "/for-homeowners", label: "For homeowners" },
    ];
  }
  if (workspace === "hosting") {
    return [
      { to: "/host/listings", label: "Your homes" },
      { to: "/host/payouts", label: "Payouts" },
      { to: "/host/claims", label: "Claims" },
      { to: "/messages", label: "Messages", badge: unread },
    ];
  }
  return [
    { to: "/explore", label: "Find a home" },
    { to: "/trips", label: "Your stays" },
    { to: "/messages", label: "Messages", badge: unread },
  ];
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden
        className="money ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[0.6875rem] font-bold leading-5 text-white"
      >
        {count > 9 ? "9+" : count}
      </span>
      <span className="sr-only">
        , {count} unread {count === 1 ? "message" : "messages"}
      </span>
    </>
  );
}

function SiteHeader({
  session,
  workspace,
  focused,
  backTo,
  backLabel,
  current,
}: {
  session: SessionView;
  workspace: Workspace;
  focused: boolean;
  backTo?: string;
  backLabel: string;
  current: string;
}) {
  const location = useLocation();
  const unread = useUnreadCount(session.user?.id);
  const items = primaryNav(session, workspace, unread);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  // A route change closes the mobile menu: its links are plain <Link>s.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  const signInHref = loginHref({ next: current, source: "header" });
  const onSignInPage = location.pathname === "/login";
  const switchTo =
    workspace === "hosting" ? { to: "/explore", label: "Find a home" } : { to: "/host/listings", label: "Your homes" };

  return (
    <header className="sticky top-0 z-30 border-b border-divider bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex h-[72px] w-full max-w-content items-center gap-4 px-5 sm:px-8 lg:h-20 lg:px-16">
        {focused && backTo ? (
          <Link
            to={backTo}
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-ink no-underline hover:bg-surface lg:hidden"
          >
            <BackChevron className="h-[13px] w-[8px]" />
            {backLabel}
          </Link>
        ) : null}
        <Link to="/" className="inline-flex shrink-0 items-center no-underline" aria-label="Stead home">
          <BrandLockup />
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden flex-1 lg:block">
          <ul className="m-0 flex list-none items-center gap-6 p-0">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `inline-flex min-h-control items-center border-b-2 px-0.5 text-[0.9375rem] font-semibold no-underline ${
                      isActive ? "border-brand text-brand" : "border-transparent text-ink hover:text-brand"
                    }`
                  }
                >
                  {item.label}
                  {item.badge ? <Badge count={item.badge} /> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {session.loading ? (
            <span aria-hidden className="h-10 w-24" />
          ) : session.user ? (
            <>
              <ButtonLink to={switchTo.to} variant="secondary" size="sm" className="hidden lg:inline-flex">
                {switchTo.label}
              </ButtonLink>
              <div className="hidden lg:block">
                <AccountMenu session={session} />
              </div>
            </>
          ) : onSignInPage ? null : (
            <>
              <Link
                to={signInHref}
                className="inline-flex min-h-[44px] items-center rounded-control px-3 text-[0.9375rem] font-semibold text-ink no-underline hover:bg-surface hover:text-brand"
              >
                Sign in
              </Link>
              <ButtonLink to="/host/start" variant="secondary" size="sm" className="hidden sm:inline-flex">
                List your home
              </ButtonLink>
            </>
          )}
          {session.loading ? null : (
            <Button
              variant="quiet"
              size="sm"
              className="lg:hidden"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
            >
              <MenuIcon className="h-6 w-6" />
              Menu
            </Button>
          )}
        </div>
      </div>

      <div id={menuId}>
        <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" variant="sheet" closeLabel="Close menu">
          <MobileMenu session={session} unread={unread} signInHref={signInHref} />
        </Dialog>
      </div>
    </header>
  );
}

function initialsFor(user: { name: string | null; email: string }): string {
  const source = user.name?.trim() || user.email;
  return source.slice(0, 1).toUpperCase();
}

function useSignOutAndLeave() {
  const signOut = useSignOut();
  const navigate = useNavigate();
  const location = useLocation();
  return {
    pending: signOut.isPending,
    run: () =>
      signOut.mutate(undefined, {
        onSuccess: () => {
          if (isMemberRoute(location.pathname)) navigate("/", { replace: true });
        },
      }),
  };
}

/** Desktop account disclosure: profile, both workspaces, ops, sign out. */
function AccountMenu({ session }: { session: SessionView }) {
  const user = session.user;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const signOut = useSignOutAndLeave();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!user) return null;

  const linkClass =
    "flex min-h-[44px] items-center rounded-control px-3 text-[0.9375rem] font-semibold text-ink no-underline hover:bg-surface hover:text-brand";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-control px-2 text-[0.9375rem] font-semibold text-ink hover:bg-surface"
      >
        <span
          aria-hidden
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-accent text-sm font-semibold text-brand"
        >
          {initialsFor(user)}
        </span>
        Account
        <ChevronDownIcon />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-40 mt-2 w-64 rounded-card border border-divider bg-canvas p-2 shadow-elevated"
      >
        <p className="m-0 truncate px-3 py-2 text-sm text-ink-secondary" title={user.email}>
          {user.name?.trim() || user.email}
        </p>
        <Link to={`/passport/${user.id}`} className={linkClass}>
          Your profile
        </Link>
        <Link to="/trips" className={linkClass}>
          Your stays
        </Link>
        <Link to="/messages" className={linkClass}>
          Messages
        </Link>
        <div className="my-1 border-t border-divider" />
        <Link to="/host/listings" className={linkClass}>
          Your homes
        </Link>
        <Link to="/host/payouts" className={linkClass}>
          Payouts
        </Link>
        <Link to="/host/claims" className={linkClass}>
          Claims
        </Link>
        {session.isOps ? (
          <Link to="/ops" className={linkClass}>
            Operations
          </Link>
        ) : null}
        <div className="my-1 border-t border-divider" />
        <button
          type="button"
          disabled={signOut.pending}
          onClick={signOut.run}
          className={`${linkClass} w-full text-left disabled:opacity-60`}
        >
          {signOut.pending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

/** Everything reachable from the mobile header's Menu sheet. */
function MobileMenu({ session, unread, signInHref }: { session: SessionView; unread: number; signInHref: string }) {
  const user = session.user;
  const signOut = useSignOutAndLeave();
  const linkClass =
    "flex min-h-control items-center rounded-control px-3 text-base font-semibold text-ink no-underline hover:bg-surface";

  if (!user) {
    return (
      <nav aria-label="Menu">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <Link to="/explore" className={linkClass}>
              Find a home
            </Link>
          </li>
          <li>
            <Link to="/for-homeowners" className={linkClass}>
              For homeowners
            </Link>
          </li>
          <li>
            <Link to="/host/start" className={linkClass}>
              List your home
            </Link>
          </li>
        </ul>
        <div className="mt-4 border-t border-divider pt-4">
          <ButtonLink to={signInHref} block>
            Sign in
          </ButtonLink>
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="Menu" className="flex flex-col gap-5">
      <p className="m-0 truncate px-3 text-sm text-ink-secondary" title={user.email}>
        {user.name?.trim() || user.email}
      </p>
      <div>
        <p className="m-0 px-3 pb-1 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">Renting</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <Link to="/explore" className={linkClass}>
              Find a home
            </Link>
          </li>
          <li>
            <Link to="/trips" className={linkClass}>
              Your stays
            </Link>
          </li>
          <li>
            <Link to="/messages" className={linkClass}>
              Messages
              <Badge count={unread} />
            </Link>
          </li>
          <li>
            <Link to={`/passport/${user.id}`} className={linkClass}>
              Your profile
            </Link>
          </li>
        </ul>
      </div>
      <div>
        <p className="m-0 px-3 pb-1 text-metadata font-bold uppercase tracking-[0.14em] text-ink-secondary">Hosting</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <Link to="/host/listings" className={linkClass}>
              Your homes
            </Link>
          </li>
          <li>
            <Link to="/host/payouts" className={linkClass}>
              Payouts
            </Link>
          </li>
          <li>
            <Link to="/host/claims" className={linkClass}>
              Claims
            </Link>
          </li>
          {session.isOps ? (
            <li>
              <Link to="/ops" className={linkClass}>
                Operations
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
      <div className="border-t border-divider pt-4">
        <Button variant="secondary" block busy={signOut.pending} busyLabel="Signing out…" onClick={signOut.run}>
          Sign out
        </Button>
      </div>
    </nav>
  );
}
