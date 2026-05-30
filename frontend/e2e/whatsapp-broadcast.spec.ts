/**
 * E2E smoke tests for the WhatsApp broadcast page (/settings/whatsapp/broadcast).
 *
 * Coverage:
 *   - @smoke: admin navigates to /settings/whatsapp/broadcast and sees the form.
 *   - @smoke: non-admin (requester) is redirected away from the broadcast page.
 *
 * No WhatsApp secrets are required — the form renders unconditionally; template
 * and role-count API calls fail silently when WHATSAPP_* env vars are unset.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("WhatsApp broadcast page", () => {
  test("admin sees WhatsApp broadcast form @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    await page.goto("/settings/whatsapp/broadcast");

    await expect(
      page.getByRole("heading", { name: /broadcast/i })
    ).toBeVisible({ timeout: 10_000 });

    // Recipients card
    await expect(page.getByText("Recipients")).toBeVisible();

    // Send button (dynamic label: "Send to N recipient(s)")
    await expect(page.getByRole("button", { name: /send to .* recipient/i })).toBeVisible();
  });

  test("non-admin is redirected away from /settings/whatsapp/broadcast @smoke", async ({ page }) => {
    await loginAs(page, "user");

    await page.goto("/settings/whatsapp/broadcast");

    // Should be redirected to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });
});
