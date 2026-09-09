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
const EMAIL_FROM = process.env.AUTH_EMAIL_FROM ?? "Stead <onboarding@resend.dev>";

export interface Message {
  to: string;
  subject: string;
  text: string;
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

/**
 * Deposit released. Deliberately precise about what happened to the money:
 * on a card-on-file deposit nothing was ever taken, and saying so is the whole
 * reassurance.
 */
export function depositReleasedEmail(input: {
  listingTitle: string;
  amountCents: number;
}): Omit<Message, "to"> {
  return {
    subject: "Your deposit is released",
    text: [
      `The claim window on your stay at ${input.listingTitle} has closed with no claim,`,
      `so your ${formatCents(input.amountCents)} deposit is released.`,
      "",
      "Your card was never charged for it, and now it won't be.",
    ].join("\n"),
  };
}

export function claimFiledEmail(input: {
  listingTitle: string;
  amountCents: number;
}): Omit<Message, "to"> {
  return {
    subject: "A claim was filed on your stay",
    text: [
      `The host of ${input.listingTitle} filed a claim for ${formatCents(input.amountCents)} against your deposit.`,
      "",
      "You can accept that figure or dispute it. Independent arbitration decides a dispute.",
    ].join("\n"),
  };
}

export function claimAcceptedEmail(input: {
  listingTitle: string;
  amountCents: number;
}): Omit<Message, "to"> {
  return {
    subject: "The guest accepted your claim",
    text: [
      `The guest accepted your ${formatCents(input.amountCents)} claim on ${input.listingTitle}.`,
      "That amount is charged from the card on file and lands with you.",
    ].join("\n"),
  };
}

export function claimDisputedEmail(input: { listingTitle: string }): Omit<Message, "to"> {
  return {
    subject: "The guest disputed your claim",
    text: [
      `The guest disputed your claim on ${input.listingTitle}.`,
      "An independent arbiter will resolve it — host, guest, or a split.",
    ].join("\n"),
  };
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
  return {
    subject: "A claim was resolved",
    text: [`The claim on ${input.listingTitle} was resolved ${what}`].join("\n"),
  };
}

/** Reviews open at listing-local checkout. Follow-up reminders are Slice 7. */
export function reviewOpenEmail(input: { listingTitle: string }): Omit<Message, "to"> {
  return {
    subject: "Your review is open",
    text: [
      `Checkout on ${input.listingTitle} is done, so the review is open.`,
      "",
      "Double-blind: the other side cannot read yours until theirs is in — or 14 days pass. Then both publish at once.",
      "Permanent once published, and tied to the booking receipt.",
    ].join("\n"),
  };
}
