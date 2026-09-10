import { afterEach, describe, expect, it, vi } from "vitest";
import { sendVerificationRequest } from "../server/auth";
import { EmailFromError } from "../server/lib/emailFrom";
import { sendEmail } from "../server/lib/email";
import { selectEmailProvider } from "../server/lib/emailProvider";

const saved = {
  from: process.env.AUTH_EMAIL_FROM,
  resend: process.env.RESEND_API_KEY,
  postmark: process.env.POSTMARK_SERVER_TOKEN,
  postmarkAlias: process.env.POSTMARK_API_TOKEN,
};

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function clearSendKeys() {
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.POSTMARK_API_TOKEN;
}

afterEach(() => {
  restore("AUTH_EMAIL_FROM", saved.from);
  restore("RESEND_API_KEY", saved.resend);
  restore("POSTMARK_SERVER_TOKEN", saved.postmark);
  restore("POSTMARK_API_TOKEN", saved.postmarkAlias);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("selectEmailProvider", () => {
  it("returns null when no send key is set", () => {
    clearSendKeys();
    expect(selectEmailProvider()).toBeNull();
  });

  it("selects Postmark when only POSTMARK_SERVER_TOKEN is set", () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    expect(selectEmailProvider()).toBe("postmark");
  });

  it("selects Postmark from the POSTMARK_API_TOKEN alias", () => {
    clearSendKeys();
    process.env.POSTMARK_API_TOKEN = "pm_alias";
    expect(selectEmailProvider()).toBe("postmark");
  });

  it("selects Resend when only RESEND_API_KEY is set", () => {
    clearSendKeys();
    process.env.RESEND_API_KEY = "re_test";
    expect(selectEmailProvider()).toBe("resend");
  });

  it("prefers Postmark when both keys are set", () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    process.env.RESEND_API_KEY = "re_test";
    expect(selectEmailProvider()).toBe("postmark");
  });

  it("ignores blank tokens and falls through to Resend", () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "   ";
    process.env.POSTMARK_API_TOKEN = "";
    process.env.RESEND_API_KEY = "re_test";
    expect(selectEmailProvider()).toBe("resend");
  });
});

describe("sendEmail provider path", () => {
  const mail = {
    to: "guest@example.com",
    subject: "Your deposit is released",
    text: "Released.",
    html: "<p>Released.</p>",
  };

  it("prints to the console and does not fetch when no key is set", async () => {
    clearSendKeys();
    delete process.env.AUTH_EMAIL_FROM;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(sendEmail(mail)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("POSTs to Postmark with AUTH_EMAIL_FROM as From", async () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    process.env.AUTH_EMAIL_FROM = "Stead <noreply@openstead.app>";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(mail)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Postmark-Server-Token")).toBe("pm_test");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      From: "Stead <noreply@openstead.app>",
      To: mail.to,
      Subject: mail.subject,
      TextBody: mail.text,
      HtmlBody: mail.html,
    });
  });

  it("POSTs to Resend when only RESEND_API_KEY is set", async () => {
    clearSendKeys();
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "Stead <hello@openstead.app>";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(mail)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: "Stead <hello@openstead.app>",
      to: mail.to,
    });
  });

  it("hits Postmark, not Resend, when both keys are set", async () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "Stead <noreply@openstead.app>";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(mail)).resolves.toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.postmarkapp.com/email");
  });

  it("refuses an unset From and does not fetch", async () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    delete process.env.AUTH_EMAIL_FROM;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendEmail(mail)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error.mock.calls.join(" ")).toMatch(/AUTH_EMAIL_FROM is not set/);
  });

  it("refuses onboarding@resend.dev and does not fetch", async () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    process.env.AUTH_EMAIL_FROM = "Stead <onboarding@resend.dev>";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendEmail(mail)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error.mock.calls.join(" ")).toMatch(/onboarding@resend\.dev/);
  });
});

describe("sendVerificationRequest", () => {
  const params = {
    identifier: "member@example.com",
    url: "https://stead.example/api/auth/callback?token=demo",
    provider: { from: "Stead <noreply@openstead.app>" },
  };

  it("POSTs the magic link through Postmark", async () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    process.env.AUTH_EMAIL_FROM = "Stead <noreply@openstead.app>";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendVerificationRequest(params);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.postmarkapp.com/email");
    const body = JSON.parse(String(init.body)) as { From: string; To: string; Subject: string };
    expect(body.From).toBe("Stead <noreply@openstead.app>");
    expect(body.To).toBe("member@example.com");
    expect(body.Subject).toBe("Your Stead sign-in link");
  });

  it("throws and does not fetch when From is onboarding@", async () => {
    clearSendKeys();
    process.env.POSTMARK_API_TOKEN = "pm_alias";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendVerificationRequest({
        ...params,
        provider: { from: "onboarding@resend.dev" },
      }),
    ).rejects.toBeInstanceOf(EmailFromError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
