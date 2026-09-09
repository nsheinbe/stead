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

/** Reviews open at listing-local checkout. Follow-up reminders are below. */
export function reviewOpenEmail(input: { listingTitle: string }): Omit<Message, "to"> {
  return mail("Your review is open", "Reviews with receipts", "Your review is open", [
    `Checkout on ${input.listingTitle} is done, so the review is open.`,
    "Double-blind: the other side cannot read yours until theirs is in — or 14 days pass. Then both publish at once.",
    "Permanent once published, and tied to the booking receipt.",
  ]);
}

export function reviewReminderEmail(input: {
  listingTitle: string;
  kind: "day3" | "day7";
  reviewUrl: string;
}): Omit<Message, "to"> {
  const when = input.kind === "day7" ? "A week has passed" : "A few days have passed";
  return {
    subject: `Still time to review ${input.listingTitle}`,
    text: [
      `${when} since checkout at ${input.listingTitle}, and your review is still open.`,
      "",
      "Double-blind: the other side cannot read yours until theirs is in — or 14 days pass. Then both publish at once.",
      "",
      `Write it here: ${input.reviewUrl}`,
    ].join("\n"),
    html: brandedEmailHtml({
      eyebrow: "Reviews with receipts",
      heading: `Still time to review ${input.listingTitle}`,
      paragraphs: [
        `${when} since checkout, and your review is still open.`,
        "Double-blind: the other side cannot read yours until theirs is in — or 14 days pass. Then both publish at once.",
      ],
      cta: { href: input.reviewUrl, label: "Write your review" },
    }),
  };
}

export function watchdogAlertEmail(input: {
  stale: { job: string; lastOk: Date | null; lastError: string | null }[];
  errored: { job: string; lastOk: Date | null; lastError: string | null }[];
}): Omit<Message, "to"> {
  const staleLines = input.stale.map((row) => {
    const when = row.lastOk ? row.lastOk.toISOString() : "never";
    return `• ${row.job} — last ok ${when}`;
  });
  const errorLines = input.errored.map((row) => `• ${row.job} — ${row.lastError ?? "errored"}`);
  const paragraphs = [
    "A scheduled job on Stead is stale or still carrying an error. Check the ops view.",
    staleLines.length ? `Stale:\n${staleLines.join("\n")}` : "",
    errorLines.length ? `Errored:\n${errorLines.join("\n")}` : "",
  ].filter(Boolean);
  return mail("Stead watchdog: a job needs a look", "Ops", "A scheduled job needs a look", paragraphs);
}

export function newMessageEmail(input: {
  senderName: string;
  listingTitle: string;
  preview: string;
  threadUrl: string;
}): Omit<Message, "to"> {
  const preview = input.preview.length > 180 ? `${input.preview.slice(0, 177)}…` : input.preview;
  return {
    subject: `${input.senderName} wrote about ${input.listingTitle}`,
    text: [
      `${input.senderName} sent a message about ${input.listingTitle}.`,
      "",
      preview,
      "",
      `Open the thread: ${input.threadUrl}`,
    ].join("\n"),
    html: brandedEmailHtml({
      eyebrow: "Inbox",
      heading: `${input.senderName} wrote about ${input.listingTitle}`,
      paragraphs: [preview],
      cta: { href: input.threadUrl, label: "Open the thread" },
    }),
  };
}

export function guestCanceledEmail(input: {
  listingTitle: string;
  guestName: string;
  refundCents: number;
}): Omit<Message, "to"> {
  const figure = formatCents(input.refundCents);
  return mail("A guest canceled a stay", "Cancellations", `${input.guestName} canceled ${input.listingTitle}`, [
    input.refundCents > 0
      ? `The guest canceled. ${figure} goes back to their card. The deposit is released.`
      : "The guest canceled. The policy keeps the stay. The deposit is released.",
  ]);
}

export function guestCanceledConfirmEmail(input: {
  listingTitle: string;
  refundCents: number;
}): Omit<Message, "to"> {
  const figure = formatCents(input.refundCents);
  return mail("Your stay is canceled", "Cancellations", "Your stay is canceled", [
    input.refundCents > 0
      ? `${input.listingTitle} is canceled. ${figure} returns to your card. The deposit is released.`
      : `${input.listingTitle} is canceled. The policy keeps the stay. The deposit is released.`,
  ]);
}

export function hostCanceledEmail(input: {
  listingTitle: string;
  hostName: string;
  refundCents: number;
  forGuest: boolean;
}): Omit<Message, "to"> {
  const figure = formatCents(input.refundCents);
  if (input.forGuest) {
    return mail("The host canceled your stay", "Cancellations", `${input.hostName} canceled ${input.listingTitle}`, [
      `The stay and the 2% come back in full — ${figure}. The deposit is released. Those dates are blacked out.`,
    ]);
  }
  return mail("You canceled a stay", "Cancellations", `You canceled ${input.listingTitle}`, [
    `The guest is refunded ${figure}, fee included. The deposit is released. Those dates are blacked out, and this counts as a host cancel on your Trust Passport.`,
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
