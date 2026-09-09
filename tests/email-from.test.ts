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
  key: process.env.RESEND_API_KEY,
};

afterEach(() => {
  if (saved.from === undefined) delete process.env.AUTH_EMAIL_FROM;
  else process.env.AUTH_EMAIL_FROM = saved.from;
  if (saved.key === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = saved.key;
});

describe("authEmailFromForSend", () => {
  it("accepts a verified-domain display address", () => {
    expect(authEmailFromForSend("Stead <noreply@mail.example.com>")).toBe(
      "Stead <noreply@mail.example.com>",
    );
    expect(extractFromEmail("Stead <noreply@mail.example.com>")).toBe("noreply@mail.example.com");
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

  it("names the placeholder, not a domain we do not own", () => {
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
  it("uses a never-sent localhost from when Resend is unset", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    expect(authEmailFromForConfig()).toBe("Stead <dev@localhost>");
  });

  it("still refuses onboarding@ when a key is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "Stead <onboarding@resend.dev>";
    expect(() => authEmailFromForConfig()).toThrow(EmailFromError);
  });

  it("requires AUTH_EMAIL_FROM once a key is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    delete process.env.AUTH_EMAIL_FROM;
    expect(() => authEmailFromForConfig()).toThrow(/AUTH_EMAIL_FROM is not set/);
  });
});
