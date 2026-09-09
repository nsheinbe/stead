/**
 * Production from-address for Auth.js + Resend.
 *
 * `onboarding@resend.dev` is Resend's shared sandbox. Gmail (and others) drop
 * or spam it. We refuse to send with it — or with an empty AUTH_EMAIL_FROM —
 * rather than silently fail for members. Local-dev without RESEND_API_KEY
 * still prints the magic link to the console and does not need a from-address.
 *
 * Do not invent a domain. Code reads AUTH_EMAIL_FROM. Docs use
 * `Stead <noreply@YOUR_VERIFIED_DOMAIN>`.
 */
const ONBOARDING = /onboarding@resend\.dev/i;
const EMAIL_IN_FROM = /(?:<)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?:>)?/i;

export class EmailFromError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailFromError";
  }
}

export const AUTH_EMAIL_FROM_EXAMPLE = "Stead <noreply@YOUR_VERIFIED_DOMAIN>";

const UNSET_MESSAGE =
  `AUTH_EMAIL_FROM is not set. Resend will not send until it is an address on a ` +
  `domain you verified in Resend (e.g. ${AUTH_EMAIL_FROM_EXAMPLE}). ` +
  `onboarding@resend.dev is refused — Gmail drops it.`;

const ONBOARDING_MESSAGE =
  `AUTH_EMAIL_FROM still points at onboarding@resend.dev. That sandbox address ` +
  `is not a production from — Gmail recipients never see the mail. Set ` +
  `AUTH_EMAIL_FROM to an address on a domain you verified in Resend ` +
  `(e.g. ${AUTH_EMAIL_FROM_EXAMPLE}).`;

const SHAPE_MESSAGE =
  `AUTH_EMAIL_FROM must be an email or 'Name <email@domain>' ` +
  `(e.g. ${AUTH_EMAIL_FROM_EXAMPLE}).`;

export function extractFromEmail(raw: string): string | null {
  const match = raw.trim().match(EMAIL_IN_FROM);
  return match?.[1]?.toLowerCase() ?? null;
}

export function isOnboardingFrom(raw: string): boolean {
  return ONBOARDING.test(raw);
}

/**
 * The address Resend will put on the message. Throws rather than return
 * onboarding@ or an empty value.
 */
export function authEmailFromForSend(raw = process.env.AUTH_EMAIL_FROM): string {
  const value = raw?.trim() ?? "";
  if (!value) throw new EmailFromError(UNSET_MESSAGE);
  if (isOnboardingFrom(value)) throw new EmailFromError(ONBOARDING_MESSAGE);
  if (!extractFromEmail(value)) throw new EmailFromError(SHAPE_MESSAGE);
  return value;
}

/**
 * Auth.js wants a `from` even when we only print the link. A never-sent
 * localhost placeholder is fine locally. The moment RESEND_API_KEY is set,
 * the real from is required and onboarding@ is refused.
 */
export function authEmailFromForConfig(): string {
  if (process.env.RESEND_API_KEY) return authEmailFromForSend();
  const raw = process.env.AUTH_EMAIL_FROM?.trim() ?? "";
  if (raw && !isOnboardingFrom(raw) && extractFromEmail(raw)) return raw;
  return "Stead <dev@localhost>";
}

/** Loud in function logs; does not throw so /api/health still answers. */
export function logEmailFromMisconfig(): void {
  if (!process.env.RESEND_API_KEY) return;
  try {
    authEmailFromForSend();
  } catch (err) {
    console.error(`[email] ${err instanceof Error ? err.message : err}`);
  }
}
