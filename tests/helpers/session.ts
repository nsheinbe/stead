/**
 * Mint an Auth.js session cookie the same way the running app will read it.
 * Salt must match the cookie name or decode fails closed.
 */
import { encode } from "@auth/core/jwt";

export const SESSION_COOKIE = "authjs.session-token";

export const E2E_AUTH_SECRET = "e2e-auth-secret-at-least-32-characters-long";
export const E2E_CRON_SECRET = "e2e-cron-secret-please-rotate";

export async function mintSessionValue(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? E2E_AUTH_SECRET;
  return encode({
    token: { sub: user.id, email: user.email, name: user.name ?? null },
    secret,
    salt: SESSION_COOKIE,
    maxAge: 60 * 60 * 24,
  });
}

export async function mintSessionCookie(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  return `${SESSION_COOKIE}=${await mintSessionValue(user)}`;
}
