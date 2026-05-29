/**
 * E2E smoke test for the "Link Telegram" flow on the Profile page (Phase 4b).
 *
 * Coverage:
 *   - @smoke: requester logs in, navigates to /profile, clicks "Link Telegram",
 *     dialog opens, and a code (or deep link) is rendered.
 *
 * No Telegram secrets are required — POST /api/tg/link/code returns a code
 * regardless of TELEGRAM_BOT_USERNAME being set.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Telegram link dialog", () => {
  test("user can open Link Telegram dialog and see a code @smoke", async ({ page }) => {
    await loginAs(page, "user");

    await page.goto("/profile");

    // Wait for page to finish loading (loading spinner disappears)
    await expect(page.getByRole("button", { name: "Link Telegram" })).toBeVisible({
      timeout: 10_000,
    });

    // Open the dialog
    await page.getByRole("button", { name: "Link Telegram" }).click();

    // Dialog heading should be visible
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("heading", { name: /link telegram/i })
    ).toBeVisible();

    // Either a deep link button or a /start code block should appear
    // (depends on whether TELEGRAM_BOT_USERNAME env is set)
    const deepLinkBtn = page.getByRole("link", { name: /open telegram/i });
    const codeBlock = page.locator("code").filter({ hasText: "/start" });

    const hasDeepLink = await deepLinkBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    const hasCode = await codeBlock.isVisible({ timeout: 8_000 }).catch(() => false);

    expect(
      hasDeepLink || hasCode,
      "Dialog should show either a deep link or a /start code block"
    ).toBe(true);
  });
});
