/**
 * E2E smoke tests for the Telegram settings page (/settings/telegram).
 *
 * Coverage:
 *   - @smoke: admin navigates to /settings/telegram and sees the page heading.
 *   - @smoke: non-admin (requester) is redirected away from /settings/telegram.
 *
 * No Telegram secrets are required — the page renders "not configured" gracefully.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Telegram settings page", () => {
  test("admin sees Telegram settings heading @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto("/settings/telegram");

    await expect(
      page.getByRole("heading", { name: /telegram/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("non-admin is redirected away from /settings/telegram @smoke", async ({ page }) => {
    await loginAs(page, "user");

    await page.goto("/settings/telegram");

    // Should be redirected to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });
});
