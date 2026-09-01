/**
 * Auth.js v5 on @auth/core. Magic-link email only, exactly as before — the
 * difference is that the tokens and the member row now live in our own Neon
 * database instead of hosted Supabase Auth.
 *
 * Sessions are JWTs in an httpOnly, SameSite=Lax cookie. There is no RLS
 * behind this, so `requireUser` is the only thing standing between a request
 * and someone else's booking; every query in server/queries takes the id it
 * returns.
 *
 * TODO: Google is a config change now — add GoogleProvider here and the button
 * to /login once an OAuth client is supplied. public.accounts already exists.
 */
import { Auth, type AuthConfig } from "@auth/core";
import Resend from "@auth/core/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "./db/client";
import { accounts, sessions, users, verificationTokens } from "./db/schema";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

const EMAIL_FROM = process.env.AUTH_EMAIL_FROM ?? "Stead <onboarding@resend.dev>";

function signInEmail(url: string, host: string): { subject: string; text: string; html: string } {
  const subject = `Your Stead sign-in link`;
  const text = [
    "A link. That is the whole door.",
    "",
    `Sign in to Stead: ${url}`,
    "",
    "The link works once and expires in 24 hours. If you did not ask for it, ignore this —",
    "nobody can sign in without opening it.",
    "",
    host,
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,'Hanken Grotesk',sans-serif;background:#FBFAF7;color:#17201B;padding:32px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#B58B3E">Member sign-in</p>
      <h1 style="margin:0 0 16px;font-size:26px;font-weight:600">A link. That is the whole door.</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:rgba(23,32,27,.7)">
        It works once and expires in 24 hours. If you did not ask for it, ignore this — nobody can sign in without opening it.
      </p>
      <a href="${url}" style="display:inline-block;background:#1E4034;color:#FBFAF7;text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:700">
        Sign in to Stead
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:rgba(23,32,27,.5)">${host}</p>
    </div>
  `;
  return { subject, text, html };
}

/**
 * Resend when a key is configured; otherwise print the link so local
 * development works without an email provider.
 */
async function sendVerificationRequest(params: {
  identifier: string;
  url: string;
  provider: { from?: string };
}): Promise<void> {
  const host = new URL(params.url).host;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`\n  Magic link for ${params.identifier}:\n  ${params.url}\n`);
    return;
  }
  const { subject, text, html } = signInEmail(params.url, host);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: params.provider.from ?? EMAIL_FROM, to: params.identifier, subject, text, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend refused the sign-in email: ${res.status} ${await res.text()}`);
  }
}

let cached: AuthConfig | undefined;

export function authConfig(): AuthConfig {
  if (cached) return cached;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  }
  const db = getDb();
  cached = {
    secret,
    trustHost: true,
    basePath: "/api/auth",
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
    pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" },
    providers: [
      Resend({
        apiKey: process.env.RESEND_API_KEY ?? "unset",
        from: EMAIL_FROM,
        sendVerificationRequest,
      }),
    ],
    callbacks: {
      jwt({ token, user }) {
        if (user?.id) token.sub = user.id;
        return token;
      },
      session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
  return cached;
}

export function handleAuthRequest(request: Request): Promise<Response> {
  return Auth(request, authConfig());
}

/** Reads the signed session cookie. Returns null for anonymous requests. */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const origin = new URL(request.url).origin;
  const probe = new Request(`${origin}/api/auth/session`, { headers: request.headers });
  const response = await Auth(probe, authConfig());
  if (!response.ok) return null;
  const session = (await response.json()) as {
    user?: { id?: string; email?: string | null; name?: string | null };
  } | null;
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.name ?? null };
}
