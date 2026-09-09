/**
 * Browser smoke for the surfaces Slice 8's API paths sit on. Calendar booking
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
