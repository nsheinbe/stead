/**
 * Safe continuation after sign-in.
 *
 * `next` is the one place a URL from the outside world becomes a navigation
 * target, so it is normalised through an allowlist rather than forwarded.
 * Accepted: a same-origin application path from the route table below, with
 * only that route's known query fields. Rejected, always to the fallback:
 * anything absolute or protocol-relative (`//`), backslashes, encoded slashes,
 * control characters, `/api/*`, and `/login` itself (an auth loop).
 *
 * `intent` and `source` are bounded attribution labels for measurement and
 * copy. They never grant anything; the server decides permissions.
 *
 * Pure: no `window`, so the server's Auth.js redirect boundary can share it.
 */
export const INTENTS = ["renter", "homeowner", "unknown"] as const;
export type Intent = (typeof INTENTS)[number];

export const SOURCES = [
  "landing_primary",
  "landing_homeowner",
  "homeowner_hero",
  "header",
  "mobile_nav",
  "listing_booking",
  "listing_message",
  "protected_deep_link",
  "unknown",
] as const;
export type Source = (typeof SOURCES)[number];

export const DEFAULT_CONTINUATION = "/trips";
export const HOMEOWNER_CONTINUATION = "/host/start";

const ID = "[A-Za-z0-9-]{1,64}";

type RouteRule = { pattern: RegExp; query?: readonly string[] };

const EXPLORE_QUERY = ["q", "city", "type", "guests", "maxRate", "instant"] as const;

const ROUTES: readonly RouteRule[] = [
  { pattern: /^\/$/ },
  { pattern: /^\/explore$/, query: EXPLORE_QUERY },
  { pattern: /^\/for-homeowners$/ },
  { pattern: new RegExp(`^/listing/${ID}$`) },
  { pattern: new RegExp(`^/book/${ID}$`), query: ["draft"] },
  { pattern: /^\/trips$/ },
  { pattern: new RegExp(`^/trips/${ID}$`) },
  { pattern: /^\/messages$/ },
  { pattern: new RegExp(`^/messages/${ID}$`) },
  { pattern: new RegExp(`^/messages/${ID}/${ID}$`) },
  { pattern: new RegExp(`^/review/${ID}$`) },
  { pattern: new RegExp(`^/passport/${ID}$`) },
  { pattern: /^\/host\/start$/ },
  { pattern: /^\/host\/listings$/, query: ["create", "setup"] },
  { pattern: new RegExp(`^/host/listings/${ID}$`), query: ["setup"] },
  { pattern: /^\/host\/payouts$/, query: ["done", "refresh"] },
  { pattern: /^\/host\/claims$/ },
  { pattern: new RegExp(`^/host/claims/${ID}$`) },
  { pattern: /^\/ops$/ },
];

const MAX_LENGTH = 2048;
const MAX_VALUE_LENGTH = 200;
const PLACEHOLDER_ORIGIN = "http://stead.invalid";

/** True when `raw` is a same-origin application path we are willing to send someone to. */
export function isSafeContinuation(raw: unknown): raw is string {
  return normalizeOrNull(raw) !== null;
}

function normalizeOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // Plain path only: one leading slash, then something that is not a slash or backslash.
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/%2f|%5c|%00|%0a|%0d/i.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  if (url.username || url.password) return null;

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/api")) return null;

  const rule = ROUTES.find((candidate) => candidate.pattern.test(pathname));
  if (!rule) return null;

  const params = new URLSearchParams();
  for (const key of rule.query ?? []) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) continue;
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) continue;
    params.set(key, trimmed);
  }
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

/**
 * The one normalisation function. Returns a clean application path, or the
 * fallback when the input is missing, malformed, foreign or an auth loop.
 */
export function normalizeContinuation(raw: unknown, fallback: string = DEFAULT_CONTINUATION): string {
  return normalizeOrNull(raw) ?? normalizeOrNull(fallback) ?? DEFAULT_CONTINUATION;
}

export function parseIntent(raw: unknown): Intent {
  return typeof raw === "string" && (INTENTS as readonly string[]).includes(raw) ? (raw as Intent) : "unknown";
}

export function parseSource(raw: unknown): Source {
  return typeof raw === "string" && (SOURCES as readonly string[]).includes(raw) ? (raw as Source) : "unknown";
}

export type LoginContext = {
  next: string;
  intent: Intent;
  source: Source;
};

/** Reads `/login?next=&intent=&source=` back into a validated context. */
export function parseLoginContext(search: string | URLSearchParams): LoginContext {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const intent = parseIntent(params.get("intent"));
  return {
    next: normalizeContinuation(
      params.get("next"),
      intent === "homeowner" ? HOMEOWNER_CONTINUATION : DEFAULT_CONTINUATION,
    ),
    intent,
    source: parseSource(params.get("source")),
  };
}

/**
 * Builds the sign-in link for a call to action. Only a valid `next` is carried;
 * `intent`/`source` are dropped unless they are allowlisted values.
 */
export function loginHref({
  next,
  intent,
  source,
}: {
  next?: string | null;
  intent?: Intent;
  source?: Source;
} = {}): string {
  const params = new URLSearchParams();
  const safeNext = normalizeOrNull(next);
  if (safeNext && safeNext !== DEFAULT_CONTINUATION) params.set("next", safeNext);
  if (intent && intent !== "unknown" && (INTENTS as readonly string[]).includes(intent)) params.set("intent", intent);
  if (source && source !== "unknown" && (SOURCES as readonly string[]).includes(source)) params.set("source", source);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

/**
 * Where a signed-in visitor lands when they open /login with a valid context.
 * Used for the "Continue to …" action and for the Auth.js callback URL.
 */
export function continuationLabel(next: string): string {
  if (next.startsWith("/book/")) return "Continue to your stay";
  if (next === "/host/start" || next.startsWith("/host/listings")) return "Continue your listing";
  if (next.startsWith("/messages/")) return "Open conversation";
  if (next.startsWith("/host/")) return "Continue to hosting tools";
  if (next.startsWith("/trips")) return "Continue to your stays";
  return "Continue";
}
