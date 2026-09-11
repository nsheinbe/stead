/**
 * Auth.js v5 on @auth/core. Magic-link email only, exactly as before — the
 * difference is that the tokens and the member row now live in our own Neon
 * database instead of hosted Supabase Auth.
 *
 * Sessions are JWTs in an httpOnly, SameSite=Lax cookie. The id this returns
 * becomes app.user_id on the request's transaction, which is what every RLS
 * policy reads.
 *
 * This runs on its own connection as auth_user, which has grants on the four
 * identity tables and on nothing else. A bug here cannot read a booking, and a
 * bug in the booking path cannot read an email address.
 *
 * TODO: Google is a config change now — add GoogleProvider here and the button
 * to /login once an OAuth client is supplied. public.accounts already exists.
 */
import { Auth, type AuthConfig } from "@auth/core";
import Resend from "@auth/core/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getAuthDb } from "./db/client";
import { accounts, sessions, users, verificationTokens } from "./db/schema";
import { EmailFromError, authEmailFromForConfig, authEmailFromForSend } from "./lib/emailFrom";
import { signInEmail } from "./lib/email";
import { deliverViaProvider, selectEmailProvider } from "./lib/emailProvider";
import { DEFAULT_CONTINUATION, normalizeContinuation } from "../src/lib/continuation";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Postmark (preferred) or Resend when a send key is configured; otherwise
 * print the link so local development works without an email provider. A
 * key without a verified AUTH_EMAIL_FROM fails closed — we will not send
 * as onboarding@resend.dev.
 */
export async function sendVerificationRequest(params: {
  identifier: string;
  url: string;
  provider: { from?: string };
}): Promise<void> {
  const host = new URL(params.url).host;
  const emailProvider = selectEmailProvider();
  if (!emailProvider) {
    console.log(`\n  Magic link for ${params.identifier}:\n  ${params.url}\n`);
    return;
  }
  let from: string;
  try {
    from = authEmailFromForSend(params.provider.from);
  } catch (err) {
    const message = err instanceof EmailFromError ? err.message : "AUTH_EMAIL_FROM is invalid";
    console.error(`[auth] refusing the sign-in email — ${message}`);
    throw err instanceof EmailFromError ? err : new EmailFromError(message);
  }
  const { subject, text, html } = signInEmail(params.url, host);
  await deliverViaProvider(emailProvider, {
    from,
    to: params.identifier,
    subject,
    text,
    html,
  });
}

/**
 * Where Auth.js sends the browser after a sign-in link is used (or after
 * sign-out). The callbackUrl arrives from the browser and, for the email
 * flow, from a link in someone's inbox, so it is normalised through the same
 * allowlist the client uses: same origin only, a known application path,
 * only that route's query keys, never /login or /api. Anything else lands on
 * the default destination instead of wherever the URL pointed.
 */
export function resolveCallbackUrl(url: string, baseUrl: string): string {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return DEFAULT_CONTINUATION;
  }
  let target: URL;
  try {
    target = new URL(url, origin);
  } catch {
    return `${origin}${DEFAULT_CONTINUATION}`;
  }
  if (target.origin !== origin) return `${origin}${DEFAULT_CONTINUATION}`;
  return `${origin}${normalizeContinuation(`${target.pathname}${target.search}`)}`;
}

let cached: AuthConfig | undefined;

export function authConfig(): AuthConfig {
  if (cached) return cached;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  }
  cached = {
    secret,
    trustHost: true,
    basePath: "/api/auth",
    adapter: DrizzleAdapter(getAuthDb(), {
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
        from: authEmailFromForConfig(),
        sendVerificationRequest,
      }),
    ],
    callbacks: {
      redirect({ url, baseUrl }) {
        return resolveCallbackUrl(url, baseUrl);
      },
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
