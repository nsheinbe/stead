import { describe, expect, it } from "vitest";
import {
  claimAcceptedEmail,
  claimDisputedEmail,
  claimFiledEmail,
  claimResolvedEmail,
  depositReleasedEmail,
  guestCanceledConfirmEmail,
  guestCanceledEmail,
  hostCanceledEmail,
  newMessageEmail,
  reviewOpenEmail,
  reviewReminderEmail,
  signInEmail,
  watchdogAlertEmail,
} from "../server/lib/email";
import { brandedEmailHtml, escapeHtml } from "../server/lib/emailLayout";

const BANNED = /\b(blockchain|crypto|wallet|token|web3|DAO|smart contract|on-chain|gas)\b/i;

const TEMPLATES = [
  depositReleasedEmail({ listingTitle: "Gable End Cottage", amountCents: 30_000 }),
  claimFiledEmail({ listingTitle: "Gable End Cottage", amountCents: 8_500 }),
  claimAcceptedEmail({ listingTitle: "Gable End Cottage", amountCents: 8_500 }),
  claimDisputedEmail({ listingTitle: "Gable End Cottage" }),
  claimResolvedEmail({
    listingTitle: "Gable End Cottage",
    resolutionAmountCents: 4_000,
    outcome: "split",
  }),
  reviewOpenEmail({ listingTitle: "Gable End Cottage" }),
  newMessageEmail({
    senderName: "Sam",
    listingTitle: "Gable End Cottage",
    preview: "Is August still free?",
    threadUrl: "https://stead.example/messages/listing/guest",
  }),
  guestCanceledEmail({ listingTitle: "Gable End Cottage", guestName: "Sam", refundCents: 612_000 }),
  guestCanceledConfirmEmail({ listingTitle: "Gable End Cottage", refundCents: 612_000 }),
  hostCanceledEmail({
    listingTitle: "Gable End Cottage",
    hostName: "Nora",
    refundCents: 612_000,
    forGuest: true,
  }),
  hostCanceledEmail({
    listingTitle: "Gable End Cottage",
    hostName: "Nora",
    refundCents: 612_000,
    forGuest: false,
  }),
  signInEmail("https://stead.example/api/auth/callback?k=demo", "stead.example"),
  reviewReminderEmail({
    listingTitle: "Gable End Cottage",
    kind: "day3",
    reviewUrl: "https://stead.example/review/demo",
  }),
  watchdogAlertEmail({
    stale: [{ job: "check-in", lastOk: new Date("2026-09-01T00:00:00Z"), lastError: null }],
    errored: [{ job: "expire-pending", lastOk: null, lastError: "boom" }],
  }),
];

describe("branded transactional email", () => {
  it("every template has text, html, and no banned words", () => {
    for (const mail of TEMPLATES) {
      expect(mail.text.length).toBeGreaterThan(20);
      expect(mail.html).toContain("Stead");
      expect(mail.html).toContain("#1E4034");
      expect(mail.html).toContain("#FBFAF7");
      expect(mail.text).not.toMatch(BANNED);
      expect(mail.html).not.toMatch(BANNED);
    }
  });

  it("deposit release names the figure and says the card was never charged", () => {
    const mail = depositReleasedEmail({ listingTitle: "Gable End Cottage", amountCents: 30_000 });
    expect(mail.text).toContain("$300.00");
    expect(mail.html).toContain("$300.00");
    expect(mail.text).toMatch(/never charged/i);
  });

  it("sign-in html puts the magic link on a button, not as raw injection", () => {
    const mail = signInEmail("https://stead.example/login?x=<script>", "stead.example");
    expect(mail.html).toContain("https://stead.example/login?x=&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("Sign in to Stead");
  });

  it("escapes copy that lands in the branded chrome", () => {
    expect(escapeHtml(`<b>x</b>`)).toBe("&lt;b&gt;x&lt;/b&gt;");
    const html = brandedEmailHtml({
      eyebrow: "Claims",
      heading: "A <claim>",
      paragraphs: ["Host said <hi>"],
    });
    expect(html).toContain("A &lt;claim&gt;");
    expect(html).toContain("Host said &lt;hi&gt;");
    expect(html).not.toContain("<claim>");
  });
});
