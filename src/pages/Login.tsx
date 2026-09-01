import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BrandMark } from "../components/BrandMark";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";

export function LoginPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/trips";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(params.get("sent") === "1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const callbackUrl = `${window.location.origin}${next.startsWith("/") ? next : "/trips"}`;
      await api.sendSignInLink(email, callbackUrl);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the sign-in link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell hideNav>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-[18px] py-16">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-display text-[27px] font-bold">Stead</span>
        </div>
        <div>
          <p className="mb-2 text-[12.5px] font-bold uppercase tracking-[0.2em] text-brass">Member sign-in</p>
          <h1 className="m-0 font-display text-[32px] font-semibold leading-tight">A link. That is the whole door.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
            Magic link by email. No password to lose. Google sign-in is deferred until an OAuth client is supplied.
          </p>
        </div>

        {user ? (
          <StatusBanner
            title="You are signed in"
            detail="Head to trips, or find another stay. Host tools arrive in a later slice."
          />
        ) : null}
        {sent ? (
          <StatusBanner
            title="Check your email"
            detail="Open the link on this device. The hold on a pending checkout still expires in 30 minutes."
          />
        ) : null}
        {error ? <StatusBanner tone="claim" title={error} /> : null}

        {!user ? (
          <form onSubmit={(e) => void sendLink(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold tracking-wider text-ink/50">EMAIL</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl border border-linen-tint bg-paper px-4 py-3.5 text-[15px]"
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !email}
              className="rounded-xl bg-spruce py-4 text-[15.5px] font-bold text-paper hover:bg-spruce-deep"
            >
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        ) : null}

        <div className="flex gap-4 text-sm font-semibold">
          <Link to="/explore" className="no-underline">
            Find a stay
          </Link>
          {user ? (
            <Link to="/trips" className="no-underline">
              Your trips
            </Link>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
