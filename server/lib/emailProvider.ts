/**
 * Which outbound mail API we hit.
 *
 * Postmark is preferred when both keys are set — Stead production uses the
 * Postmark free tier with openstead.app. Resend stays as a fallback. With
 * neither key, callers print to the console (the intended local-dev path).
 *
 * Tokens: POSTMARK_SERVER_TOKEN, or POSTMARK_API_TOKEN as an alias.
 */
export type EmailProvider = "postmark" | "resend";

export function postmarkServerToken(): string | undefined {
  const token =
    process.env.POSTMARK_SERVER_TOKEN?.trim() || process.env.POSTMARK_API_TOKEN?.trim();
  return token || undefined;
}

export function resendApiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || undefined;
}

/** True when any provider can actually send (so AUTH_EMAIL_FROM is required). */
export function hasEmailSendKey(): boolean {
  return Boolean(postmarkServerToken() || resendApiKey());
}

export function selectEmailProvider(): EmailProvider | null {
  if (postmarkServerToken()) return "postmark";
  if (resendApiKey()) return "resend";
  return null;
}

export type OutboundEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

function providerLabel(provider: EmailProvider): string {
  return provider === "postmark" ? "Postmark" : "Resend";
}

export async function deliverViaProvider(
  provider: EmailProvider,
  message: OutboundEmail,
): Promise<void> {
  const label = providerLabel(provider);
  try {
    const res =
      provider === "postmark" ? await postToPostmark(message) : await postToResend(message);
    if (!res.ok) {
      throw new Error(`${label} refused ${message.subject}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${label} refused`)) throw err;
    throw new Error(`could not reach ${label}`, { cause: err });
  }
}

async function postToPostmark(message: OutboundEmail): Promise<Response> {
  const token = postmarkServerToken();
  if (!token) throw new Error("Postmark token missing");
  return fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: message.from,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
    }),
  });
}

async function postToResend(message: OutboundEmail): Promise<Response> {
  const apiKey = resendApiKey();
  if (!apiKey) throw new Error("Resend key missing");
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
}
