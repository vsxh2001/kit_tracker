/**
 * E2E smoke tests for the WhatsApp settings page (/settings/whatsapp).
 *
 * Coverage:
 *   - @smoke: admin navigates to /settings/whatsapp and sees the page heading.
 *   - @smoke: non-admin (requester) is redirected away from /settings/whatsapp.
 *
 * No WhatsApp secrets are required — the page renders "unavailable" gracefully
 * when WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN are unset.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("WhatsApp settings page", () => {
  test("admin sees WhatsApp settings heading @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto("/settings/whatsapp");

    await expect(
      page.getByRole("heading", { name: /whatsapp/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("non-admin is redirected away from /settings/whatsapp @smoke", async ({ page }) => {
    await loginAs(page, "user");

    await page.goto("/settings/whatsapp");

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });
});
