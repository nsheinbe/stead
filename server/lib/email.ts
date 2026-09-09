/**
 * Transactional email over Resend, matching how server/auth.ts sends the magic
 * link: a plain fetch, and without RESEND_API_KEY the message prints to the
 * server console instead. That console path is the intended local-dev
 * behaviour, not a degraded mode — see README.
 *
 * Sending never throws into a caller's critical path. A cron that released a
 * deposit correctly has done the important part; a bounced notification must
 * not roll that back or fail the job.
 */
import { brandedEmailHtml } from "./emailLayout";

const EMAIL_FROM = process.env.AUTH_EMAIL_FROM ?? "Stead <onboarding@resend.dev>";

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(message: Message): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`\n  Email to ${message.to} — ${message.subject}\n  ${message.text}\n`);
    return true;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend refused ${message.subject}: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] could not reach Resend", err);
    return false;
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function mail(
  subject: string,
  eyebrow: string,
  heading: string,
  paragraphs: string[],
): Omit<Message, "to"> {
  return {
    subject,
    text: paragraphs.join("\n\n"),
    html: brandedEmailHtml({ eyebrow, heading, paragraphs }),
  };
}

/**
 * Deposit released. Deliberately precise about what happened to the money:
 * on a card-on-file deposit nothing was ever taken, and saying so is the whole
 * reassurance.
 */
export function depositReleasedEmail(input: {
  listingTitle: string;
  amountCents: number;
}): Omit<Message, "to"> {
  return mail("Your deposit is released", "Neutral escrow", "Your deposit is released", [
    `The claim window on your stay at ${input.listingTitle} has closed with no claim, so your ${formatCents(input.amountCents)} deposit is released.`,
    "Your card was never charged for it, and now it won't be.",
  ]);
}

export function claimFiledEmail(input: {
  listingTitle: string;
  amountCents: number;
}): Omit<Message, "to"> {
  return mail("A claim was filed on your stay", "Claims", "A claim was filed on your stay", [
    `The host of ${input.listingTitle} filed a claim for ${formatCents(input.amountCents)} against your deposit.`,
    "You can accept that figure or dispute it. Independent arbitration decides a dispute.",
  ]);
}

export function claimAcceptedEmail(input: {
  listingTitle: string;
  amountCents: number;
}): Omit<Message, "to"> {
  return mail("The guest accepted your claim", "Claims", "The guest accepted your claim", [
    `The guest accepted your ${formatCents(input.amountCents)} claim on ${input.listingTitle}.`,
    "That amount is charged from the card on file and lands with you.",
  ]);
}

export function claimDisputedEmail(input: { listingTitle: string }): Omit<Message, "to"> {
  return mail("The guest disputed your claim", "Claims", "The guest disputed your claim", [
    `The guest disputed your claim on ${input.listingTitle}.`,
    "An independent arbiter will resolve it — host, guest, or a split.",
  ]);
}

export function claimResolvedEmail(input: {
  listingTitle: string;
  resolutionAmountCents: number;
  outcome: "host" | "guest" | "split";
}): Omit<Message, "to"> {
  const figure = formatCents(input.resolutionAmountCents);
  const what =
    input.outcome === "guest"
      ? "in the guest's favour. Nothing is charged."
      : input.outcome === "split"
        ? `as a split. ${figure} is charged from the card on file.`
        : `in the host's favour. ${figure} is charged from the card on file.`;
  return mail("A claim was resolved", "Independent arbitration", "A claim was resolved", [
    `The claim on ${input.listingTitle} was resolved ${what}`,
  ]);
}

/** Reviews open at listing-local checkout. Follow-up reminders are Slice 7. */
export function reviewOpenEmail(input: { listingTitle: string }): Omit<Message, "to"> {
  return mail("Your review is open", "Reviews with receipts", "Your review is open", [
    `Checkout on ${input.listingTitle} is done, so the review is open.`,
    "Double-blind: the other side cannot read yours until theirs is in — or 14 days pass. Then both publish at once.",
    "Permanent once published, and tied to the booking receipt.",
  ]);
}

export function signInEmail(url: string, host: string): Omit<Message, "to"> {
  return {
    subject: "Your Stead sign-in link",
    text: [
      "A link. That is the whole door.",
      "",
      `Sign in to Stead: ${url}`,
      "",
      "The link works once and expires in 24 hours. If you did not ask for it, ignore this —",
      "nobody can sign in without opening it.",
      "",
      host,
    ].join("\n"),
    html: brandedEmailHtml({
      eyebrow: "Member sign-in",
      heading: "A link. That is the whole door.",
      paragraphs: [
        "It works once and expires in 24 hours. If you did not ask for it, ignore this — nobody can sign in without opening it.",
        host,
      ],
      cta: { href: url, label: "Sign in to Stead" },
    }),
  };
}
