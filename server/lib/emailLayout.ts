/**
 * Shared branded HTML for every outbound email. Inline styles only — email
 * clients ignore stylesheets. Tokens match /design/DESIGN_HANDOFF.md.
 *
 * Text bodies stay first-class: sendEmail always sends text, and HTML is the
 * dressed-up twin, never the only copy.
 */
const PAPER = "#FBFAF7";
const INK = "#17201B";
const SPRUCE = "#1E4034";
const BRASS = "#B58B3E";
const LINEN = "#EFE9DF";

export type EmailCta = { href: string; label: string };

export function brandedEmailHtml(input: {
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  cta?: EmailCta;
}): string {
  const paras = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:rgba(23,32,27,.72)">${escapeHtml(p)}</p>`,
    )
    .join("");
  const cta = input.cta
    ? `<a href="${escapeAttr(input.cta.href)}" style="display:inline-block;background:${SPRUCE};color:${PAPER};text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:700">${escapeHtml(input.cta.label)}</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:${LINEN};color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.heading)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${LINEN};padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%;background:${PAPER};border-radius:16px;overflow:hidden">
          <tr>
            <td style="background:${SPRUCE};padding:22px 32px">
              <p style="margin:0;font-family:Georgia,'Ibarra Real Nueva',serif;font-size:22px;font-weight:700;color:${PAPER};letter-spacing:-0.01em">Stead</p>
              <p style="margin:6px 0 0;font-family:system-ui,-apple-system,'Hanken Grotesk',sans-serif;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#DDB672">Member-owned home rentals</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;font-family:system-ui,-apple-system,'Hanken Grotesk',sans-serif;color:${INK}">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${BRASS}">${escapeHtml(input.eyebrow)}</p>
              <h1 style="margin:0 0 20px;font-family:Georgia,'Ibarra Real Nueva',serif;font-size:26px;line-height:1.2;font-weight:600;color:${INK}">${escapeHtml(input.heading)}</h1>
              ${paras}
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 28px;font-family:system-ui,-apple-system,'Hanken Grotesk',sans-serif;font-size:12px;line-height:1.5;color:rgba(23,32,27,.5)">
              The fee is 2%. Neutral escrow. Portable reputation. That is the whole trick.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
