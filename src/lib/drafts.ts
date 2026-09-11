/**
 * Same-device drafts: a renter's stay selection and a homeowner's pre-create
 * choices, kept in local storage so an email sign-in (same browser, any tab)
 * does not throw them away.
 *
 * Rules, from the build plan:
 * - Versioned, time-limited (24 h), validated field by field on the way back in.
 * - Only listing id, dates, guest count and the rate/fee seen at save time for
 *   the renter; only type, title, place, capacity and time zone for the
 *   homeowner. No email, address, description, secrets or payment data.
 * - Scoped to the member that saved it: a draft saved while signed in as A is
 *   never restored for B. Drafts saved while signed out belong to whoever
 *   signs in next on this device — that is the flow they exist for.
 * - Storage failure degrades to "could not save on this device"; it never
 *   blocks sign-in or booking.
 */
import type { ListingType } from "./types";
import { defaultStorage, keysWithPrefix, type StorageLike } from "./storage";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = "stead:draft:";
const BOOKING_PREFIX = `${PREFIX}booking:`;
const HOST_KEY = `${PREFIX}host_precreate`;

export type BookingSelectionDraft = {
  schemaVersion: 1;
  kind: "booking_selection";
  draftId: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  /** The price the member saw when saving, so a change can be announced on restore. */
  nightlyRateCents: number | null;
  networkFeeBps: number | null;
  ownerId: string | null;
  updatedAt: string;
  expiresAt: string;
};

export type HostPrecreateFields = {
  title?: string;
  type?: ListingType;
  city?: string;
  country?: string;
  timezone?: string;
  maxGuests?: number;
};

export type HostPrecreateDraft = {
  schemaVersion: 1;
  kind: "host_precreate";
  draftId: string;
  fields: HostPrecreateFields;
  ownerId: string | null;
  updatedAt: string;
  expiresAt: string;
};

export type RestoreResult<T> =
  | { status: "restored"; draft: T }
  | { status: "missing" }
  | { status: "expired" }
  | { status: "incompatible" }
  | { status: "unavailable" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const LISTING_TYPES: ListingType[] = ["entire_home", "apartment", "private_room"];

export function newDraftId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function ownerOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && ID.test(value)) return value;
  return undefined;
}

function parseBooking(raw: string): BookingSelectionDraft | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || v.kind !== "booking_selection") return null;
  if (typeof v.draftId !== "string" || !ID.test(v.draftId)) return null;
  if (typeof v.listingId !== "string" || !ID.test(v.listingId)) return null;
  if (!isIsoDate(v.checkIn) || !isIsoDate(v.checkOut) || v.checkOut <= v.checkIn) return null;
  if (typeof v.guests !== "number" || !Number.isInteger(v.guests) || v.guests < 1 || v.guests > 50) return null;
  const nightlyRateCents =
    v.nightlyRateCents === null || v.nightlyRateCents === undefined
      ? null
      : typeof v.nightlyRateCents === "number" && Number.isInteger(v.nightlyRateCents) && v.nightlyRateCents >= 0
        ? v.nightlyRateCents
        : undefined;
  const networkFeeBps =
    v.networkFeeBps === null || v.networkFeeBps === undefined
      ? null
      : typeof v.networkFeeBps === "number" && Number.isInteger(v.networkFeeBps) && v.networkFeeBps >= 0
        ? v.networkFeeBps
        : undefined;
  if (nightlyRateCents === undefined || networkFeeBps === undefined) return null;
  const ownerId = ownerOf(v.ownerId);
  if (ownerId === undefined) return null;
  if (!isTimestamp(v.updatedAt) || !isTimestamp(v.expiresAt)) return null;
  return {
    schemaVersion: 1,
    kind: "booking_selection",
    draftId: v.draftId,
    listingId: v.listingId,
    checkIn: v.checkIn,
    checkOut: v.checkOut,
    guests: v.guests,
    nightlyRateCents,
    networkFeeBps,
    ownerId,
    updatedAt: v.updatedAt,
    expiresAt: v.expiresAt,
  };
}

function parseHost(raw: string): HostPrecreateDraft | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || v.kind !== "host_precreate") return null;
  if (typeof v.draftId !== "string" || !ID.test(v.draftId)) return null;
  const ownerId = ownerOf(v.ownerId);
  if (ownerId === undefined) return null;
  if (!isTimestamp(v.updatedAt) || !isTimestamp(v.expiresAt)) return null;
  if (!v.fields || typeof v.fields !== "object") return null;
  const f = v.fields as Record<string, unknown>;
  const fields: HostPrecreateFields = {};
  if (typeof f.title === "string" && f.title.length <= 140) fields.title = f.title;
  if (typeof f.type === "string" && LISTING_TYPES.includes(f.type as ListingType)) fields.type = f.type as ListingType;
  if (typeof f.city === "string" && f.city.length <= 140) fields.city = f.city;
  if (typeof f.country === "string" && /^[A-Za-z]{0,2}$/.test(f.country)) fields.country = f.country.toUpperCase();
  if (typeof f.timezone === "string" && f.timezone.length <= 64) fields.timezone = f.timezone;
  if (typeof f.maxGuests === "number" && Number.isInteger(f.maxGuests) && f.maxGuests >= 1 && f.maxGuests <= 50) {
    fields.maxGuests = f.maxGuests;
  }
  return {
    schemaVersion: 1,
    kind: "host_precreate",
    draftId: v.draftId,
    fields,
    ownerId,
    updatedAt: v.updatedAt,
    expiresAt: v.expiresAt,
  };
}

function expired(draft: { expiresAt: string }, now: Date): boolean {
  return Date.parse(draft.expiresAt) <= now.getTime();
}

/** A draft belongs to the member who saved it, or to anyone if saved signed out. */
function ownedBy(draft: { ownerId: string | null }, viewerId: string | null): boolean {
  return draft.ownerId === null || draft.ownerId === viewerId;
}

function readRaw(storage: StorageLike, key: string): string | null | undefined {
  try {
    return storage.getItem(key);
  } catch {
    return undefined;
  }
}

function removeRaw(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

// --- booking selections --------------------------------------------------

export type SaveBookingInput = {
  draftId?: string;
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nightlyRateCents?: number | null;
  networkFeeBps?: number | null;
  ownerId: string | null;
};

export type SaveResult<T> = { ok: true; draft: T } | { ok: false; reason: "unavailable" };

export function saveBookingDraft(
  input: SaveBookingInput,
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): SaveResult<BookingSelectionDraft> {
  if (!storage) return { ok: false, reason: "unavailable" };
  const draft: BookingSelectionDraft = {
    schemaVersion: 1,
    kind: "booking_selection",
    draftId: input.draftId ?? newDraftId(),
    listingId: input.listingId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    nightlyRateCents: input.nightlyRateCents ?? null,
    networkFeeBps: input.networkFeeBps ?? null,
    ownerId: input.ownerId,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  };
  try {
    storage.setItem(`${BOOKING_PREFIX}${draft.draftId}`, JSON.stringify(draft));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, draft };
}

export function readBookingDraft(
  draftId: string,
  viewerId: string | null,
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): RestoreResult<BookingSelectionDraft> {
  if (!storage) return { status: "unavailable" };
  if (!ID.test(draftId)) return { status: "missing" };
  const key = `${BOOKING_PREFIX}${draftId}`;
  const raw = readRaw(storage, key);
  if (raw === undefined) return { status: "unavailable" };
  if (raw === null) return { status: "missing" };
  const draft = parseBooking(raw);
  if (!draft) {
    removeRaw(storage, key);
    return { status: "incompatible" };
  }
  if (expired(draft, now)) {
    removeRaw(storage, key);
    return { status: "expired" };
  }
  if (!ownedBy(draft, viewerId)) {
    // Another member's selection on a shared browser is never shown.
    removeRaw(storage, key);
    return { status: "missing" };
  }
  return { status: "restored", draft };
}

/** The newest unexpired selection for a listing that this viewer may see. */
export function latestBookingDraftForListing(
  listingId: string,
  viewerId: string | null,
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): BookingSelectionDraft | null {
  if (!storage) return null;
  let best: BookingSelectionDraft | null = null;
  for (const key of keysWithPrefix(storage, BOOKING_PREFIX)) {
    const raw = readRaw(storage, key);
    if (!raw) continue;
    const draft = parseBooking(raw);
    if (!draft || expired(draft, now)) {
      removeRaw(storage, key);
      continue;
    }
    if (draft.listingId !== listingId || !ownedBy(draft, viewerId)) continue;
    if (!best || Date.parse(draft.updatedAt) > Date.parse(best.updatedAt)) best = draft;
  }
  return best;
}

export function deleteBookingDraft(draftId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage || !ID.test(draftId)) return;
  removeRaw(storage, `${BOOKING_PREFIX}${draftId}`);
}

// --- homeowner pre-create choices -----------------------------------------

export function saveHostPrecreateDraft(
  fields: HostPrecreateFields,
  ownerId: string | null,
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): SaveResult<HostPrecreateDraft> {
  if (!storage) return { ok: false, reason: "unavailable" };
  const existing = readRaw(storage, HOST_KEY);
  const previous = existing ? parseHost(existing) : null;
  const draft: HostPrecreateDraft = {
    schemaVersion: 1,
    kind: "host_precreate",
    draftId: previous?.draftId ?? newDraftId(),
    fields,
    ownerId,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  };
  try {
    storage.setItem(HOST_KEY, JSON.stringify(draft));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, draft };
}

export function readHostPrecreateDraft(
  viewerId: string | null,
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): RestoreResult<HostPrecreateDraft> {
  if (!storage) return { status: "unavailable" };
  const raw = readRaw(storage, HOST_KEY);
  if (raw === undefined) return { status: "unavailable" };
  if (raw === null) return { status: "missing" };
  const draft = parseHost(raw);
  if (!draft) {
    removeRaw(storage, HOST_KEY);
    return { status: "incompatible" };
  }
  if (expired(draft, now)) {
    removeRaw(storage, HOST_KEY);
    return { status: "expired" };
  }
  if (!ownedBy(draft, viewerId)) {
    removeRaw(storage, HOST_KEY);
    return { status: "missing" };
  }
  return { status: "restored", draft };
}

export function clearHostPrecreateDraft(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  removeRaw(storage, HOST_KEY);
}

// --- housekeeping ---------------------------------------------------------

/** Sign-out and account change: nothing of the previous member survives. */
export function clearAllDrafts(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  for (const key of keysWithPrefix(storage, PREFIX)) removeRaw(storage, key);
}

export function pruneExpiredDrafts(storage: StorageLike | null = defaultStorage(), now: Date = new Date()): number {
  if (!storage) return 0;
  let removed = 0;
  for (const key of keysWithPrefix(storage, PREFIX)) {
    const raw = readRaw(storage, key);
    if (!raw) continue;
    const draft = key === HOST_KEY ? parseHost(raw) : parseBooking(raw);
    if (!draft || expired(draft, now)) {
      removeRaw(storage, key);
      removed += 1;
    }
  }
  return removed;
}
