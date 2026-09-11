/**
 * QA-01 — accessibility, checked as behaviour.
 *
 * No axe here, deliberately: an automated rule sweep catches missing alt text
 * and contrast, but the things this redesign actually changed are focus,
 * naming and announcement — and those are only provable by driving the page.
 * Each test below is a task someone would fail to complete if it regressed,
 * not a rule number.
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

/** Every control a person can reach must say what it is. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      "input:not([type=hidden]), select, textarea, button, a[href]",
    );
    for (const el of controls) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const labelled = el.getAttribute("aria-label")?.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      const byId = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .join(" ")
            .trim()
        : "";
      const nativeLabel =
        el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim();
      const wrapped = el.closest("label")?.textContent?.trim();
      const text = el.textContent?.trim();
      const title = el.getAttribute("title")?.trim();

      if (!(labelled || byId || nativeLabel || wrapped || text || title)) {
        problems.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`);
      }
    }
    return problems;
  });
}

test.describe("accessibility (QA-01)", () => {
  test.setTimeout(300_000);

  test("every control on the public pages has an accessible name", async ({ page }) => {
    await ensureDb();
    const { listingId } = await seedBookableParty("A11y cottage");

    for (const path of ["/", "/explore", `/listing/${listingId}`, "/login", "/for-homeowners"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const problems = await unnamedControls(page);
      expect(problems, `unnamed controls on ${path}: ${problems.join(", ")}`).toHaveLength(0);
    }
  });

  test("every control on the homeowner forms has an accessible name", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("A11y Owner");
    await signIn(page, owner.token);

    for (const path of ["/host/start", "/host/listings", "/host/payouts"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const problems = await unnamedControls(page);
      expect(problems, `unnamed controls on ${path}: ${problems.join(", ")}`).toHaveLength(0);
    }
  });

  test("a protected page signed out still has a top-level heading", async ({ page }) => {
    await ensureDb();
    // The shell moves focus to the h1 on navigation. Without one, focus has
    // nowhere to go and the page cannot be oriented in by heading.
    for (const path of ["/trips", "/messages", "/host/listings", "/host/payouts"]) {
      await page.goto(path);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1, `h1 on signed-out ${path}`).toHaveCount(1);
    }
  });

  test("the skip link reaches the main landmark", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("a form names its errors and sends focus to the field that has one", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("A11y Errors");
    await signIn(page, owner.token);
    await page.goto("/host/start");

    await page.getByRole("button", { name: "Continue" }).click();

    // The summary takes focus itself, so the problem is announced before
    // anyone goes hunting for red text.
    const summary = page.getByRole("alert");
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();

    // And each entry moves focus to the control it names.
    await summary.getByRole("link").first().click();
    await expect(page.getByLabel("Name of the home")).toBeFocused();
  });

  test("an invalid field is marked invalid, not only coloured", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("A11y Invalid");
    await signIn(page, owner.token);
    await page.goto("/host/start");
    await page.getByRole("button", { name: "Continue" }).click();

    const title = page.getByLabel("Name of the home");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    // The message is wired to the control, so it is read with the field.
    const describedBy = await title.getAttribute("aria-describedby");
    expect(describedBy, "the error is not connected to its field").toBeTruthy();
    const described = page.locator(`#${describedBy?.split(/\s+/).join(", #")}`);
    await expect(described.filter({ hasText: /at least 3 characters/ })).toHaveCount(1);
  });

  test("a dialog takes focus and hands it back when it closes", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("A11y Dialog");
    await signIn(page, owner.token);

    // Give this owner a home so the dashboard has a delete control.
    await page.goto("/host/start");
    await page.getByLabel("Name of the home").fill("Dialog focus cottage");
    await page.getByLabel("City").fill("Hudson");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip this" }).click();
    await page.getByLabel("Nightly rate").fill("200");
    await page.getByLabel("Deposit").fill("300");
    await page.getByRole("button", { name: "Save draft and add photos" }).click();
    await expect(page).toHaveURL(/setup=photos/, { timeout: 15_000 });

    await page.goto("/host/listings");
    const trigger = page.getByRole("button", { name: "Delete" }).first();
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Escape is the standard way out, and focus must come back to where it was.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("touch targets on the mobile navigation are large enough to hit", async ({ page }) => {
    await ensureDb();
    const owner = await seedHost("A11y Touch");
    await signIn(page, owner.token);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trips");

    const navLinks = page.locator("nav a:visible");
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const box = await navLinks.nth(i).boundingBox();
      if (!box) continue;
      const name = (await navLinks.nth(i).textContent())?.trim() ?? `link ${i}`;
      // 44px is the target UI-01 committed to for anything thumb-operated.
      expect(Math.max(box.height, box.width), `${name} is too small to hit`).toBeGreaterThanOrEqual(
        44,
      );
    }
  });
});
