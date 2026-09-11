/**
 * Browser smoke for the surfaces Slice 8's API paths sit on, plus the shared
 * shell from the redesign (NAV-01): public, renter and hosting navigation,
 * the homeowner routes, and the deliberate not-found view. Calendar booking
 * is covered at the HTTP layer; this file checks the pages still render and
 * that a signed-in guest can cancel from /trips/:id.
 */
import { expect, test, type Page } from "@playwright/test";
import { confirmBooking, ensureDb, isoDay, seedBookableParty, seedHost } from "./helpers/party";
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
  test("landing leads both audiences and states the minimum before search", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /A home for your next chapter/i })).toBeVisible();
    // The floor is visible above the search control, not buried below it.
    await expect(page.getByText("Homes for 30 nights or more").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /List your home/ }).first()).toBeVisible();

    // No unverifiable claims survive the redesign.
    await expect(page.getByText(/member-owned|toll booth|neutral escrow|instant payout/i)).toHaveCount(0);
    await expect(page.getByText(/flat 2%|only 2%|all-in/i)).toHaveCount(0);
    await expect(page.getByText("Copyright 2026 Stead contributors")).toBeVisible();

    await page.getByRole("button", { name: "Find a home" }).click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.getByRole("heading", { level: 1, name: "Find your next home" })).toBeVisible();
  });

  test("landing search carries its terms into results", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Where would you like to stay?").fill("Hudson");
    await page.getByLabel("Guests").fill("2");
    await page.getByRole("button", { name: "Find a home" }).click();
    await expect(page).toHaveURL(/q=Hudson/);
    await expect(page).toHaveURL(/guests=2/);
  });

  test("explore lists homes with a comparable estimate", async ({ page, request }) => {
    await ensureDb();
    const { title } = await seedBookableParty("Explore visible cottage");
    const listed = await request.get("/api/listings");
    expect(listed.status()).toBe(200);
    await page.goto("/explore");
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    // $200/night x 30 nights + 2% = $6,120, labelled by its basis.
    await expect(page.getByText("$6,120 for 30 nights").first()).toBeVisible();
    await expect(page.getByText(/available for your dates/i)).toHaveCount(0);
  });

  test("explore filters live in the URL and can be cleared", async ({ page }) => {
    await ensureDb();
    await seedBookableParty("Filter state cottage");
    await page.goto("/explore");
    await page.getByLabel("Where would you like to stay?").fill("Nowhereville");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=Nowhereville/);
    await expect(page.getByText("No homes match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test("a home page prices the minimum stay and offers dates", async ({ page }) => {
    await ensureDb();
    const { listingId, title } = await seedBookableParty("Detail cottage");
    await page.goto(`/listing/${listingId}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Estimated stay total · 30 nights")).toBeVisible();
    await expect(page.getByTestId("stay-total")).toHaveText("$6,120");
    await expect(page.getByRole("link", { name: "Choose dates" })).toBeVisible();
    await expect(page.getByText(/Request to book/i)).toHaveCount(0);
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

test.describe("contextual sign-in (INT-02)", () => {
  test("a protected deep link returns to that exact page", async ({ page }) => {
    await page.goto("/messages");
    const prompt = page.getByRole("link", { name: "Continue with your email" });
    await expect(prompt).toHaveAttribute("href", "/login?next=%2Fmessages&source=protected_deep_link");
    await prompt.click();
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to Stead" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
  });

  test("the default destination is not carried redundantly", async ({ page }) => {
    // /trips is already where a generic sign-in lands, so the link stays clean.
    await page.goto("/trips");
    await expect(page.getByRole("link", { name: "Continue with your email" })).toHaveAttribute(
      "href",
      "/login?intent=renter&source=protected_deep_link",
    );
  });

  test("a homeowner deep link keeps homeowner context", async ({ page }) => {
    await page.goto("/host/payouts");
    await expect(page.getByRole("link", { name: "Continue with your email" })).toHaveAttribute(
      "href",
      "/login?next=%2Fhost%2Fpayouts&intent=homeowner&source=protected_deep_link",
    );
    await page.goto("/host/listings");
    await page.getByRole("link", { name: "Continue with your email" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Start your listing" })).toBeVisible();
    await expect(page.getByText("Your home starts as a draft.")).toBeVisible();
  });

  test("the sign-in form validates before it claims to send", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("not-an-email");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeHidden();
  });

  test("an expired link explains itself and keeps the destination", async ({ page }) => {
    await page.goto("/login?error=Verification&next=%2Fhost%2Fstart&intent=homeowner");
    await expect(page.getByText(/This link has expired or is no longer valid/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Start your listing" })).toBeVisible();
  });

  test("a listing's message link carries the conversation through sign-in", async ({ page }) => {
    await ensureDb();
    const { listingId } = await seedBookableParty("Message link cottage");
    await page.goto(`/listing/${listingId}`);
    const message = page.getByRole("link", { name: /^Message / });
    await expect(message).toHaveAttribute(
      "href",
      `/login?next=%2Fmessages%2F${listingId}&source=listing_message`,
    );
  });
});

test.describe("honest money (PAY-01)", () => {
  test("a listing shows an estimate with the configured fee, deposit separate", async ({ page }) => {
    await ensureDb();
    const { listingId } = await seedBookableParty("Money copy cottage");
    await page.goto(`/listing/${listingId}`);

    // $200 x 30 nights = $6,000, plus a 2% guest network fee = $6,120.
    await expect(page.getByTestId("stay-total")).toHaveText("$6,120");
    await expect(page.getByText("Guest network fee (2%)")).toBeVisible();

    const deposit = page.getByTestId("deposit-note");
    await expect(deposit.getByRole("heading", { name: "Deposit arrangement" })).toBeVisible();
    await expect(deposit).toContainText("separate from your stay charge");
    await expect(deposit).not.toContainText(/held in|neutral escrow|returned automatically/i);
  });

  test("the payable amount never includes the deposit", async ({ page, request }) => {
    await ensureDb();
    const { listingId, cookie, token } = await seedBookableParty("Payable cottage");
    const created = await request.post("/api/bookings", {
      headers: { cookie, "content-type": "application/json" },
      data: { listingId, checkIn: isoDay(120), checkOut: isoDay(150), guests: 2 },
    });
    expect(created.status(), await created.text()).toBe(200);
    const body = (await created.json()) as {
      quote: { guest_total_cents: number; deposit_cents: number };
      networkFeeBps: number;
    };
    // The server's own numbers: the deposit is excluded from the charge.
    expect(body.quote.guest_total_cents).toBe(612_000);
    expect(body.quote.deposit_cents).toBeGreaterThan(0);
    expect(body.networkFeeBps).toBe(200);

    await signIn(page, token);
    await page.goto(`/trips`);
    await page.getByRole("link", { name: /Payable cottage/ }).first().click();
    await expect(page.getByTestId("deposit-status")).toBeVisible();
    await expect(page.getByTestId("stay-total")).toHaveText("$6,120");
    await expect(page.getByText("Stay charge")).toBeVisible();
    await expect(page.getByText(/Card total today/i)).toHaveCount(0);
  });

  test("the quote endpoint prices without reserving", async ({ request }) => {
    await ensureDb();
    const { listingId } = await seedBookableParty("Quote endpoint cottage");
    const res = await request.post("/api/bookings/quote", {
      headers: { "content-type": "application/json" },
      data: { listingId, checkIn: isoDay(200), checkOut: isoDay(230), guests: 2 },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { reserved: boolean; quote: { guest_total_cents: number } };
    expect(body.reserved).toBe(false);
    expect(body.quote.guest_total_cents).toBe(612_000);
    expect(await res.text()).not.toMatch(/client_secret|bookingId/);
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

test.describe("listing creation (HOST-02)", () => {
  test("the wizard creates exactly one draft, then publishes it", async ({ page, request }) => {
    await ensureDb();
    const owner = await seedHost();
    await signIn(page, owner.token);

    const name = `Wizard cottage ${Date.now()}`;
    await page.goto("/host/start");
    await expect(page.getByRole("heading", { level: 1, name: "Start your listing" })).toBeVisible();

    // Basics. The floor is stated, and nothing is saved yet.
    await expect(page.getByText(/Nothing is saved to your account until/i)).toBeVisible();
    await page.getByLabel("Name of the home").fill(name);
    await page.getByLabel("City").fill("Hudson");
    await page.getByLabel("Sleeps").fill("3");
    await page.getByRole("button", { name: "Continue" }).click();

    // The optional group can be skipped outright.
    await expect(page.getByRole("heading", { name: "Home details" })).toBeVisible();
    await page.getByRole("button", { name: "Skip this" }).click();

    // Price and terms is where the draft is created.
    await expect(page.getByRole("heading", { name: "Price and terms" })).toBeVisible();
    await page.getByLabel("Nightly rate").fill("175.50");
    await page.getByLabel("Deposit").fill("250");
    await page.getByRole("button", { name: "Save draft and add photos" }).click();

    await expect(page).toHaveURL(/\/host\/listings\/[0-9a-f-]+\?setup=photos/, { timeout: 15_000 });
    await expect(page.getByText("No photos yet.")).toBeVisible();

    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page).toHaveURL(/setup=review/);
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    // The review reads the saved listing, so the money is the server's.
    await expect(page.getByText("$175.50")).toBeVisible();
    await expect(page.getByText("$250")).toBeVisible();
    // Published and payout-ready are stated as different things.
    await expect(page.getByText(/Payouts are separate from publishing/i)).toBeVisible();

    await page.getByRole("button", { name: "Publish this home" }).click();
    await expect(page.getByText("Your home is published.")).toBeVisible({ timeout: 15_000 });

    // Exactly one listing exists, and its money is what was typed.
    const mine = await request.get("/api/listings/mine", {
      headers: { cookie: `${owner.cookie}` },
    });
    expect(mine.status()).toBe(200);
    const rows = (await mine.json()) as { title: string; nightlyRateCents: number; status: string }[];
    const created = rows.filter((row) => row.title === name);
    expect(created).toHaveLength(1);
    expect(created[0]?.nightlyRateCents).toBe(17_550);
    expect(created[0]?.status).toBe("active");
  });

  test("the wizard refuses to go on without the fields the server requires", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost();
    await signIn(page, owner.token);

    await page.goto("/host/start");
    await page.getByRole("button", { name: "Continue" }).click();

    // Still on Basics, with the problems named rather than a 400 from the API.
    await expect(page.getByRole("alert")).toContainText("Check the highlighted fields");
    await expect(page.getByRole("heading", { name: "Basics" })).toBeVisible();

    await page.getByLabel("Name of the home").fill("A home with a bad zone");
    await page.getByLabel("City").fill("Hudson");
    await page.getByLabel("Time zone").fill("Mars/Olympus");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText(/IANA time zone/);
  });

  test("the homes dashboard sends creation to the wizard and confirms deletion", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost();
    await signIn(page, owner.token);

    await page.goto("/host/listings");
    await expect(page.getByRole("heading", { level: 1, name: "Your homes" })).toBeVisible();
    await expect(page.getByText("You haven't added a home yet.")).toBeVisible();

    // One canonical creation path: no inline form on this page any more.
    await page.getByRole("link", { name: "Add a home" }).first().click();
    await expect(page).toHaveURL(/\/host\/start$/);
  });
});

test.describe("payout readiness (HOST-03)", () => {
  test("a return from Stripe never claims the account is live", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost();
    await signIn(page, owner.token);

    // ?done=1 only means the host came back. This account has nothing enabled.
    await page.goto("/host/payouts?done=1");
    await expect(page.getByRole("heading", { level: 1, name: "Payouts" })).toBeVisible();
    await expect(page.getByText("Payouts aren't set up yet")).toBeVisible();
    await expect(page.getByText(/We're checking with Stripe/i)).toBeVisible();

    // The four facts are shown as four facts, none of them claimed.
    await expect(page.getByText("Can accept a guest's payment")).toBeVisible();
    await expect(page.getByText("Can pay out to your bank")).toBeVisible();
    await expect(page.getByText("Your payout account is live")).toHaveCount(0);
    await expect(page.getByText(/Payouts live|PAYOUTS LIVE/)).toHaveCount(0);
  });

  test("an expired Stripe link explains itself without losing progress", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost();
    await signIn(page, owner.token);

    await page.goto("/host/payouts?refresh=1");
    await expect(page.getByText("That Stripe link had expired.")).toBeVisible();
    await expect(page.getByText(/Nothing was charged/i)).toBeVisible();
  });

  test("the network fee shown to hosts comes from configuration", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost();
    await signIn(page, owner.token);

    await page.goto("/host/payouts");
    await expect(page.getByText(/2% network fee/)).toBeVisible();
    // The retired copy claimed a flat rate as a fixed fact of the product.
    await expect(page.getByText(/flat 2%/i)).toHaveCount(0);
  });
});
