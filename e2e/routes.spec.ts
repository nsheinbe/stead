/**
 * QA-01 — the route matrix.
 *
 * Every ticket in this redesign rewrote pages. The risk that creates is not a
 * wrong pixel, it is a route that throws on mount, loses its heading, or
 * renders a private surface to someone signed out. This file walks every route
 * in both auth states and checks the things that would make a page unusable
 * rather than merely ugly.
 *
 * Routes are looped inside a handful of tests rather than split into one test
 * each: the per-test overhead here is larger than the page load, and a matrix
 * of forty tests would cost more than it tells us.
 */
import { expect, test, type Page } from "@playwright/test";
import { ensureDb, seedBookableParty, seedHost } from "./helpers/party";
import { SESSION_COOKIE } from "../tests/helpers/session";

async function signIn(page: Page, token: string) {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: new URL(base).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** Routes that need no ids, with the title the shell should set. */
const STATIC_ROUTES: { path: string; title: RegExp }[] = [
  { path: "/", title: /Homes for 30 nights or more/ },
  { path: "/explore", title: /Find a home/ },
  { path: "/for-homeowners", title: /For homeowners/ },
  { path: "/login", title: /Sign in/ },
  { path: "/trips", title: /Your stays/ },
  { path: "/messages", title: /Messages/ },
  { path: "/host/start", title: /Start your listing/ },
  { path: "/host/listings", title: /Your homes/ },
  { path: "/host/payouts", title: /Payouts/ },
  { path: "/host/claims", title: /Claims/ },
  { path: "/ops", title: /Operations/ },
  { path: "/definitely-not-a-route", title: /Page not found/ },
];

/** Collect anything the page threw, so a silent mount failure is loud here. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("route matrix (QA-01)", () => {
  // These walk a dozen routes each on purpose, so they need a budget matched
  // to the number of navigations rather than the per-test default.
  test.setTimeout(300_000);

  test("every route renders signed out, with a title and one h1", async ({ page }) => {
    await ensureDb();
    const errors = watchForErrors(page);

    for (const route of STATIC_ROUTES) {
      await page.goto(route.path);
      await expect(page, `title for ${route.path}`).toHaveTitle(route.title);

      // Exactly one h1: the shell focuses it on navigation, and two would make
      // that ambiguous for anyone navigating by heading.
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1, `h1 on ${route.path}`).toHaveCount(1);
      await expect(h1).toBeVisible();

      // The main landmark is the skip link's target on every route.
      await expect(page.locator("main#main"), `main on ${route.path}`).toHaveCount(1);
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("every route renders signed in, with a title and one h1", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("Matrix Member");
    await signIn(page, owner.token);
    const errors = watchForErrors(page);

    for (const route of STATIC_ROUTES) {
      await page.goto(route.path);
      await expect(page, `title for ${route.path}`).toHaveTitle(route.title);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1, `h1 on ${route.path}`).toHaveCount(1);
      await expect(h1).toBeVisible();
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("routes carrying an id render for the party that owns them", async ({ page }) => {
    await ensureDb();
    const { listingId, guestId, token } = await seedBookableParty("Matrix cottage");
    await signIn(page, token);
    const errors = watchForErrors(page);

    const withIds = [
      `/listing/${listingId}`,
      `/book/${listingId}`,
      `/messages/${listingId}/${guestId}`,
      `/passport/${guestId}`,
    ];

    for (const path of withIds) {
      await page.goto(path);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1, `h1 on ${path}`).toHaveCount(1);
      await expect(h1).toBeVisible();
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("a bad id gets an explanation, never a blank page or a crash", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("Bad Id Member");
    await signIn(page, owner.token);
    const errors = watchForErrors(page);

    // A syntactically valid but absent uuid: the server 404s and each page has
    // to say so in its own terms rather than rendering nothing.
    const missing = "11111111-2222-3333-4444-555555555555";
    for (const path of [
      `/listing/${missing}`,
      `/trips/${missing}`,
      `/host/listings/${missing}`,
      `/host/claims/${missing}`,
      `/passport/${missing}`,
      `/review/${missing}`,
    ]) {
      await page.goto(path);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1, `h1 on ${path}`).toHaveCount(1);
      await expect(h1, `explanation on ${path}`).not.toHaveText("");
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("private routes never render their content to a signed-out visitor", async ({ page }) => {
    await ensureDb();
    const { listingId, guestId } = await seedBookableParty("Private probe cottage");

    const privateRoutes = [
      "/trips",
      "/messages",
      "/host/listings",
      "/host/payouts",
      "/host/claims",
      "/ops",
      `/messages/${listingId}/${guestId}`,
    ];

    for (const path of privateRoutes) {
      await page.goto(path);
      // Each protected page offers a way in rather than an empty shell, and
      // the URL is preserved — INT-02's contract, re-checked across every one.
      const prompt = page.getByRole("link", { name: /Continue with your email|Sign in/i });
      await expect(prompt.first(), `sign-in prompt on ${path}`).toBeVisible();
      await expect(page, `stayed on ${path}`).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    }
  });

  test("the page works at phone width without sideways scrolling", async ({ page }) => {
    await ensureDb();
    const { listingId, token } = await seedBookableParty("Narrow cottage");
    await signIn(page, token);
    await page.setViewportSize({ width: 390, height: 844 });

    for (const path of ["/", "/explore", `/listing/${listingId}`, "/trips", "/host/start"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // A page wider than its viewport is the most common responsive failure
      // and the one nobody notices on a desktop.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    }
  });
});
