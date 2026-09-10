import { afterEach, describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_FROM_EXAMPLE,
  EmailFromError,
  authEmailFromForConfig,
  authEmailFromForSend,
  extractFromEmail,
  isOnboardingFrom,
} from "../server/lib/emailFrom";

const saved = {
  from: process.env.AUTH_EMAIL_FROM,
  resend: process.env.RESEND_API_KEY,
  postmark: process.env.POSTMARK_SERVER_TOKEN,
  postmarkAlias: process.env.POSTMARK_API_TOKEN,
};

function restoreEnv() {
  restore("AUTH_EMAIL_FROM", saved.from);
  restore("RESEND_API_KEY", saved.resend);
  restore("POSTMARK_SERVER_TOKEN", saved.postmark);
  restore("POSTMARK_API_TOKEN", saved.postmarkAlias);
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function clearSendKeys() {
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.POSTMARK_API_TOKEN;
}

afterEach(restoreEnv);

describe("authEmailFromForSend", () => {
  it("accepts a verified-domain display address", () => {
    expect(authEmailFromForSend("Stead <noreply@openstead.app>")).toBe(
      "Stead <noreply@openstead.app>",
    );
    expect(extractFromEmail("Stead <noreply@openstead.app>")).toBe("noreply@openstead.app");
  });

  it("refuses an empty value", () => {
    expect(() => authEmailFromForSend("")).toThrow(EmailFromError);
    expect(() => authEmailFromForSend(undefined)).toThrow(/AUTH_EMAIL_FROM is not set/);
  });

  it("refuses onboarding@resend.dev in any wrapping", () => {
    expect(isOnboardingFrom("Stead <onboarding@resend.dev>")).toBe(true);
    expect(() => authEmailFromForSend("Stead <onboarding@resend.dev>")).toThrow(/onboarding@resend\.dev/);
    expect(() => authEmailFromForSend("onboarding@resend.dev")).toThrow(EmailFromError);
    expect(() => authEmailFromForSend("Stead <Onboarding@Resend.dev>")).toThrow(EmailFromError);
  });

  it("refuses a value that is not an email", () => {
    expect(() => authEmailFromForSend("Stead")).toThrow(/must be an email/);
  });

  it("names the owned-domain example, not a domain we do not own", () => {
    try {
      authEmailFromForSend("");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailFromError);
      expect((err as Error).message).toContain(AUTH_EMAIL_FROM_EXAMPLE);
      expect((err as Error).message).not.toMatch(/stead\.com|getstead|joinstead/i);
    }
  });
});

describe("authEmailFromForConfig", () => {
  it("uses a never-sent localhost from when no send key is set", () => {
    clearSendKeys();
    delete process.env.AUTH_EMAIL_FROM;
    expect(authEmailFromForConfig()).toBe("Stead <dev@localhost>");
  });

  it("still refuses onboarding@ when a Resend key is present", () => {
    clearSendKeys();
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "Stead <onboarding@resend.dev>";
    expect(() => authEmailFromForConfig()).toThrow(EmailFromError);
  });

  it("still refuses onboarding@ when a Postmark token is present", () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    process.env.AUTH_EMAIL_FROM = "Stead <onboarding@resend.dev>";
    expect(() => authEmailFromForConfig()).toThrow(EmailFromError);
  });

  it("requires AUTH_EMAIL_FROM once a Resend key is present", () => {
    clearSendKeys();
    process.env.RESEND_API_KEY = "re_test";
    delete process.env.AUTH_EMAIL_FROM;
    expect(() => authEmailFromForConfig()).toThrow(/AUTH_EMAIL_FROM is not set/);
  });

  it("requires AUTH_EMAIL_FROM once a Postmark token is present", () => {
    clearSendKeys();
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    delete process.env.AUTH_EMAIL_FROM;
    expect(() => authEmailFromForConfig()).toThrow(/AUTH_EMAIL_FROM is not set/);
  });

  it("requires AUTH_EMAIL_FROM for the POSTMARK_API_TOKEN alias", () => {
    clearSendKeys();
    process.env.POSTMARK_API_TOKEN = "pm_alias";
    delete process.env.AUTH_EMAIL_FROM;
    expect(() => authEmailFromForConfig()).toThrow(/AUTH_EMAIL_FROM is not set/);
  });
});
