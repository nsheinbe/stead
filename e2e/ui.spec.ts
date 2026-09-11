/**
 * Browser smoke for the surfaces Slice 8's API paths sit on, plus the shared
 * shell from the redesign (NAV-01): public, renter and hosting navigation,
 * the homeowner routes, and the deliberate not-found view. Calendar booking
 * is covered at the HTTP layer; this file checks the pages still render and
 * that a signed-in guest can cancel from /trips/:id.
 */
import { expect, test, type Page } from "@playwright/test";
import { confirmBooking, ensureDb, isoDay, seedBookableParty } from "./helpers/party";
import { SESSION_COOKIE } from "../tests/helpers/session";

async function signIn(page: Page, token: string) {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
  const host = new URL(base).hostname;
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("public pages", () => {
  test("landing shows the fee math and a path to explore", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Member-owned home rentals/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Find a stay" }).first()).toBeVisible();
    await page.getByRole("link", { name: "Find a stay" }).first().click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.getByText(/Where to/)).toBeVisible();
  });

  test("explore lists member homes", async ({ page, request }) => {
    await ensureDb();
    const { title } = await seedBookableParty("Explore visible cottage");
    const listed = await request.get("/api/listings");
    expect(listed.status()).toBe(200);
    await page.goto("/explore");
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("shared shell", () => {
  test("signed-out header offers both paths and a contextual sign-in", async ({ page }) => {
    await page.goto("/explore");
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Find a home" })).toBeVisible();
    await expect(primary.getByRole("link", { name: "For homeowners" })).toBeVisible();
    const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in" });
    await expect(signIn).toHaveAttribute("href", "/login?next=%2Fexplore&source=header");
    await page.getByRole("banner").getByRole("link", { name: "List your home" }).click();
    await expect(page).toHaveURL(/\/host\/start$/);
    await expect(page.getByRole("heading", { level: 1, name: "Start your listing" })).toBeVisible();
    const continueLink = page.getByRole("link", { name: "Continue with your email" });
    await expect(continueLink).toHaveAttribute(
      "href",
      "/login?next=%2Fhost%2Fstart&intent=homeowner&source=homeowner_hero",
    );
  });

  test("for-homeowners explains the path and leads to /host/start", async ({ page }) => {
    await page.goto("/for-homeowners");
    await expect(page.getByRole("heading", { level: 1, name: /clearer way to host/i })).toBeVisible();
    await expect(page.getByText("Your home starts as a draft. You choose when to publish it.")).toBeVisible();
    await page.getByRole("link", { name: "Start your listing" }).first().click();
    await expect(page).toHaveURL(/\/host\/start$/);
  });

  test("unknown paths get a deliberate not-found view, not a silent redirect", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page).toHaveURL(/\/no-such-page$/);
    await expect(page.getByRole("heading", { level: 1, name: /couldn't find that page/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find a home" }).first()).toBeVisible();
    await expect(page).toHaveTitle(/Page not found/);
  });

  test("route changes move focus to the page heading", async ({ page }) => {
    await page.goto("/explore");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "For homeowners" }).click();
    await expect(page).toHaveURL(/\/for-homeowners$/);
    await expect(page).toHaveTitle(/For homeowners/);
    const focused = page.locator(":focus");
    await expect(focused).toHaveText(/clearer way to host/i);
  });

  test("mobile header opens a menu sheet and shows the bottom navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/explore");
    await expect(page.getByRole("navigation", { name: "Member navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "For homeowners" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("signed-in members see renter and hosting workspaces", async ({ page }) => {
    await ensureDb();
    const { token } = await seedBookableParty("Shell workspace cottage");
    await signIn(page, token);
    await page.goto("/trips");
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Your stays" })).toBeVisible();
    await expect(primary.getByRole("link", { name: /Messages/ })).toBeVisible();
    await page.getByRole("banner").getByRole("link", { name: "Your homes" }).click();
    await expect(page).toHaveURL(/\/host\/listings$/);
    await expect(primary.getByRole("link", { name: "Payouts" })).toBeVisible();
    await expect(primary.getByRole("link", { name: "Claims" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Find a home" })).toBeVisible();
    await page.getByRole("button", { name: "Account" }).click();
    await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  });
});

test.describe("signed-in cancel from the trip page", () => {
  test("confirm cancel shows the refund and marks the stay canceled", async ({ page, request }) => {
    await ensureDb();
    const { listingId, cookie, token, title } = await seedBookableParty("UI cancel cottage");

    const created = await request.post("/api/bookings", {
      headers: { cookie, "content-type": "application/json" },
      data: {
        listingId,
        checkIn: isoDay(45),
        checkOut: isoDay(75),
        guests: 2,
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    const body = (await created.json()) as { bookingId: string };
    await confirmBooking(body.bookingId);

    await signIn(page, token);
    await page.goto(`/trips/${body.bookingId}`);
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Cancel this stay" }).click();
    await page.getByRole("button", { name: "Confirm cancel" }).click();
    await expect(page.getByText(/canceled by guest/i)).toBeVisible({ timeout: 15_000 });
  });
});
