/**
 * E2E smoke tests for the Telegram broadcast page (/settings/telegram/broadcast).
 *
 * Coverage:
 *   - @smoke: admin navigates to /settings/telegram/broadcast and sees the form.
 *   - @smoke: non-admin (requester) is redirected away from the broadcast page.
 *
 * No Telegram secrets are required — we only check the form renders.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Telegram broadcast page", () => {
  test("admin sees Telegram broadcast form @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto("/settings/telegram/broadcast");

    await expect(
      page.getByRole("heading", { name: /telegram broadcast/i })
    ).toBeVisible({ timeout: 10_000 });

    // Recipients card
    await expect(page.getByText("Recipients")).toBeVisible();

    // Message textarea
    await expect(page.getByPlaceholder(/type your message/i)).toBeVisible();

    // Send button
    await expect(page.getByRole("button", { name: /send broadcast/i })).toBeVisible();
  });

  test("non-admin is redirected away from /settings/telegram/broadcast @smoke", async ({ page }) => {
    await loginAs(page, "user");

    await page.goto("/settings/telegram/broadcast");

    // Should be redirected to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });
});
