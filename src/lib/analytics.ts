/**
 * The measurement contract.
 *
 * Three rules decide everything in this file.
 *
 * **Nothing personal leaves the browser.** Not an email, not a name, not an
 * address, not the dates someone is considering, not the text of a message or
 * a review, not a Stripe secret, not a raw URL. `buildEvent` validates rather
 * than trusts: a property that is not on the allowlist for its event is
 * dropped, and a value that looks like personal content is refused outright.
 * The promise is narrow and worth stating exactly — no direct personal content
 * or secrets in payloads. A pseudonymous key is still data about a person.
 *
 * **A route is a template, never a URL.** `listing_detail`, not
 * `/listing/9f3c…`. Serializing a path leaks an id into analytics and turns
 * every dimension into a high-cardinality mess.
 *
 * **The browser cannot declare an outcome.** Client events are diagnostic and
 * may be blocked, dropped or forged. Money and identity outcomes are durable
 * server facts written next to the transition that caused them — this module
 * describes them, it does not decide them. `origin` says which is which, and
 * `assertServerOwned` refuses to build a server-owned event from client code.
 */

export const SCHEMA_VERSION = 1 as const;

/** Route templates. Adding a route means adding it here, deliberately. */
export const ROUTE_NAMES = [
  "home",
  "explore",
  "listing_detail",
  "checkout",
  "login",
  "trips",
  "trip_detail",
  "messages",
  "conversation",
  "review",
  "profile",
  "for_homeowners",
  "host_start",
  "host_listings",
  "host_listing_edit",
  "host_payouts",
  "host_claims",
  "host_claim_detail",
  "ops",
  "not_found",
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];

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

export type Intent = "renter" | "homeowner" | "unknown";

/**
 * Bounded error families.
 *
 * An arbitrary error string is how a stack trace, a member's email or a
 * Stripe secret ends up in an analytics payload. Diagnostics belong in the
 * operational logs, which have their own redaction and access rules.
 */
export const ERROR_FAMILIES = [
  "network",
  "validation",
  "auth_required",
  "auth_link_expired",
  "conflict",
  "rate_limited",
  "unavailable",
  "processor",
  "unknown",
] as const;
export type ErrorFamily = (typeof ERROR_FAMILIES)[number];

/** Events the browser may emit. Diagnostic, never an outcome. */
export const CLIENT_EVENTS = [
  "journey_entered",
  "primary_action_selected",
  "search_applied",
  "listing_viewed",
  "draft_restored",
  "checkout_reviewed",
  "auth_link_failed",
] as const;

/** Events only the server may emit, because only the server can know them. */
export const SERVER_EVENTS = [
  "auth_link_requested",
  "signup_verified",
  "signin_completed",
  "booking_pending_created",
  "deposit_setup_completed",
  "checkout_failed",
  "booking_confirmed",
  "renter_activated",
  "host_draft_created",
  "host_step_saved",
  "listing_published",
  "payout_setup_started",
  "host_readiness_changed",
  "homeowner_activated",
  "host_first_booking_confirmed",
] as const;

export const EVENT_NAMES = [...CLIENT_EVENTS, ...SERVER_EVENTS] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export function isServerOwnedEvent(name: EventName): boolean {
  return (SERVER_EVENTS as readonly string[]).includes(name);
}

/**
 * The properties each event may carry. Anything absent here is dropped, so a
 * new dimension is a deliberate edit rather than whatever a caller passed.
 */
export const ALLOWED_PROPERTIES: Record<EventName, readonly string[]> = {
  journey_entered: ["entry_surface", "intent"],
  primary_action_selected: ["action", "placement"],
  search_applied: ["has_location", "guest_bucket", "price_filter_set", "result_count_bucket"],
  listing_viewed: ["photo_count_bucket", "availability_state"],
  draft_restored: ["kind", "result", "age_bucket"],
  checkout_reviewed: ["nights_bucket", "deposit_method", "quote_state"],
  auth_link_failed: ["error_family", "stage"],
  auth_link_requested: ["provider", "intent", "source"],
  signup_verified: ["provider", "cohort", "attribution_state"],
  signin_completed: ["provider", "cohort", "attribution_state"],
  booking_pending_created: ["is_first_booking_attempt", "deposit_method"],
  deposit_setup_completed: ["deposit_method", "attempt_number_bucket"],
  checkout_failed: ["stage", "error_family"],
  booking_confirmed: ["booking_key", "is_first_confirmed_booking", "deposit_method"],
  renter_activated: ["activation_policy"],
  host_draft_created: ["listing_key", "entry_surface"],
  host_step_saved: ["step", "save_state"],
  listing_published: ["listing_key", "readiness_state", "readiness_policy"],
  payout_setup_started: ["entry_surface", "resumed"],
  host_readiness_changed: ["ready", "reason_code", "readiness_policy"],
  homeowner_activated: ["activation_policy"],
  host_first_booking_confirmed: ["activation_policy"],
};

export type PropertyValue = string | number | boolean;

export type MeasurementEnvelope = {
  schema_version: typeof SCHEMA_VERSION;
  event_id: string;
  event_name: EventName;
  occurred_at: string;
  origin: "client" | "server";
  environment: "development" | "test" | "staging" | "production";
  release_id: string;
  journey_id?: string;
  member_key?: string;
  event_intent: Intent;
  signup_intent?: Intent;
  route_name?: RouteName;
  source?: Source;
  experiment?: { key: string; variant: string };
  properties: Record<string, PropertyValue>;
};

/**
 * Buckets, defined once in versioned code.
 *
 * The alternative is each caller inventing its own string, which makes two
 * reports of "the same" metric quietly incomparable.
 */
export function nightsBucket(nights: number): "30-59" | "60-89" | "90+" | "invalid" {
  if (!Number.isFinite(nights) || nights < 30) return "invalid";
  if (nights < 60) return "30-59";
  if (nights < 90) return "60-89";
  return "90+";
}

export function countBucket(count: number): "0" | "1-3" | "4-10" | "11-50" | "50+" {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count <= 3) return "1-3";
  if (count <= 10) return "4-10";
  if (count <= 50) return "11-50";
  return "50+";
}

export function guestBucket(guests: number): "1" | "2" | "3-4" | "5+" {
  if (guests <= 1) return "1";
  if (guests === 2) return "2";
  if (guests <= 4) return "3-4";
  return "5+";
}

/**
 * Map a pathname to its template.
 *
 * Deliberately total: an unrecognised path is `not_found`, never the path
 * itself. There is no branch here that can return a string containing an id.
 */
export function routeNameFor(pathname: string): RouteName {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/") return "home";
  if (clean === "/explore") return "explore";
  if (clean === "/for-homeowners") return "for_homeowners";
  if (clean === "/login") return "login";
  if (clean === "/trips") return "trips";
  if (clean === "/messages") return "messages";
  if (clean === "/ops") return "ops";
  if (clean === "/host/start") return "host_start";
  if (clean === "/host/listings") return "host_listings";
  if (clean === "/host/payouts") return "host_payouts";
  if (clean === "/host/claims") return "host_claims";
  if (/^\/listing\/[^/]+$/.test(clean)) return "listing_detail";
  if (/^\/book\/[^/]+$/.test(clean)) return "checkout";
  if (/^\/trips\/[^/]+$/.test(clean)) return "trip_detail";
  if (/^\/messages\/[^/]+(\/[^/]+)?$/.test(clean)) return "conversation";
  if (/^\/review\/[^/]+$/.test(clean)) return "review";
  if (/^\/passport\/[^/]+$/.test(clean)) return "profile";
  if (/^\/host\/listings\/[^/]+$/.test(clean)) return "host_listing_edit";
  if (/^\/host\/claims\/[^/]+$/.test(clean)) return "host_claim_detail";
  return "not_found";
}

/**
 * Values that must never reach a payload, recognised by shape.
 *
 * The allowlist above is the real defence — this is the second one, for the
 * case where an allowlisted property is handed the wrong value. Better to
 * drop a dimension than to ship an email address.
 */
const FORBIDDEN_SHAPES: { name: string; test: RegExp }[] = [
  { name: "email address", test: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  { name: "URL", test: /^[a-z][a-z0-9+.-]*:\/\//i },
  { name: "path with an identifier", test: /\/[0-9a-f]{8}-[0-9a-f]{4}/i },
  { name: "Stripe secret or key", test: /\b(sk_|rk_|pi_[A-Za-z0-9]+_secret|seti_[A-Za-z0-9]+_secret)/ },
  { name: "bearer token", test: /\bBearer\s+\S+/i },
  { name: "UUID", test: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { name: "ISO date", test: /\b\d{4}-\d{2}-\d{2}\b/ },
];

export function forbiddenShape(value: PropertyValue): string | null {
  if (typeof value !== "string") return null;
  for (const shape of FORBIDDEN_SHAPES) {
    if (shape.test.test(value)) return shape.name;
  }
  return null;
}

export type BuildResult =
  | { ok: true; event: MeasurementEnvelope }
  | { ok: false; reason: string };

export type BuildInput = {
  event_name: EventName;
  origin: "client" | "server";
  environment: MeasurementEnvelope["environment"];
  release_id: string;
  event_intent?: Intent;
  signup_intent?: Intent;
  route_name?: RouteName;
  source?: Source;
  journey_id?: string;
  member_key?: string;
  experiment?: { key: string; variant: string };
  properties?: Record<string, PropertyValue>;
  /** Injected so tests are deterministic; production passes neither. */
  now?: () => Date;
  newId?: () => string;
};

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Not a security value — only an opaque dedupe key.
  return `ev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Build an envelope, or say why not.
 *
 * Unknown properties are dropped rather than rejected, so one stray caller
 * cannot silence a whole event. Forbidden *values* reject the event outright:
 * that case means something personal was about to be sent, and dropping the
 * field alone would leave the mistake in place unnoticed.
 */
export function buildEvent(input: BuildInput): BuildResult {
  if (!(EVENT_NAMES as readonly string[]).includes(input.event_name)) {
    return { ok: false, reason: `unknown event: ${String(input.event_name)}` };
  }
  if (input.origin === "client" && isServerOwnedEvent(input.event_name)) {
    return {
      ok: false,
      reason: `${input.event_name} is a server fact and cannot be emitted by the browser`,
    };
  }
  if (input.route_name && !(ROUTE_NAMES as readonly string[]).includes(input.route_name)) {
    return { ok: false, reason: `unknown route name: ${input.route_name}` };
  }
  if (input.source && !(SOURCES as readonly string[]).includes(input.source)) {
    return { ok: false, reason: `unknown source: ${input.source}` };
  }
  if (input.member_key && input.member_key.includes("@")) {
    return { ok: false, reason: "member_key must be a pseudonym, not an email address" };
  }

  const allowed = ALLOWED_PROPERTIES[input.event_name];
  const properties: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(input.properties ?? {})) {
    if (!allowed.includes(key)) continue;
    const shape = forbiddenShape(value);
    if (shape) return { ok: false, reason: `${key} looks like a ${shape}` };
    properties[key] = value;
  }

  const now = input.now ? input.now() : new Date();
  return {
    ok: true,
    event: {
      schema_version: SCHEMA_VERSION,
      event_id: input.newId ? input.newId() : randomId(),
      event_name: input.event_name,
      occurred_at: now.toISOString(),
      origin: input.origin,
      environment: input.environment,
      release_id: input.release_id,
      event_intent: input.event_intent ?? "unknown",
      ...(input.signup_intent ? { signup_intent: input.signup_intent } : {}),
      ...(input.journey_id ? { journey_id: input.journey_id } : {}),
      ...(input.member_key ? { member_key: input.member_key } : {}),
      ...(input.route_name ? { route_name: input.route_name } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.experiment ? { experiment: input.experiment } : {}),
      properties,
    },
  };
}
