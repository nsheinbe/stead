/**
 * The sign-in destination, remembered on this device while a link is in the
 * inbox. Auth.js sends an expired or reused link to /login?error=… with no
 * callback, so without this the member would land on a generic form and lose
 * where they were going. Only the validated destination and its bounded
 * labels are stored — never the email address, never a secret.
 */
import { normalizeContinuation, parseIntent, parseSource, type LoginContext } from "./continuation";
import { defaultStorage, type StorageLike } from "./storage";

const KEY = "stead:login-context";
const TTL_MS = 24 * 60 * 60 * 1000;

type Stored = LoginContext & { savedAt: string };

export function saveLoginContext(context: LoginContext, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const record: Stored = { ...context, savedAt: new Date().toISOString() };
  try {
    storage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked: signing in still works, only the destination
    // memory is lost.
  }
}

export function readLoginContext(
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): LoginContext | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const savedAt = typeof parsed.savedAt === "string" ? Date.parse(parsed.savedAt) : Number.NaN;
    if (Number.isNaN(savedAt) || now.getTime() - savedAt > TTL_MS) {
      clearLoginContext(storage);
      return null;
    }
    const intent = parseIntent(parsed.intent);
    return {
      next: normalizeContinuation(parsed.next, intent === "homeowner" ? "/host/start" : undefined),
      intent,
      source: parseSource(parsed.source),
    };
  } catch {
    clearLoginContext(storage);
    return null;
  }
}

export function clearLoginContext(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
