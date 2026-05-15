/**
 * Realtime permission propagation smoke test.
 *
 * Verifies that when an admin patches a user's role via the API, the
 * already-logged-in session reflects the new role within ~3 s — without
 * requiring a logout/reload.
 *
 * Flow:
 *   1. Create a temp user with no role.
 *   2. Log in as that user in the browser.
 *   3. Confirm the admin-only "Users" sidebar link is NOT visible.
 *   4. Via the API (admin token), patch the user's role to "admin".
 *   5. Wait up to 3 s for the "Users" sidebar link to become visible.
 *   6. Cleanup: delete the temp user.
 */

import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, patchUser } from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

test.describe("AuthContext realtime permission refresh", () => {
  const tempPassword = "Pass1234!";

  test.beforeEach(async ({ page }) => {
    // Clear auth state between tests to prevent cross-test pollution
    // (the page fixture shares browser context, so cookies persist)
    await page.context().clearCookies();
  });

  test("role promoted to admin propagates to live session within 3 s @smoke", async ({ page }) => {
    // Create a unique temp user for this test
    const tempEmail = `rt-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-promote@kit.local`;
    const user = await createTestUser(tempEmail, "");
    const tempUserId = user.id;

    try {
      // Log in as the temp user via UI
      await page.goto("/login");
      await page.getByLabel("Email").fill(tempEmail);
      await page.getByLabel("Password").fill(tempPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard", { timeout: 10_000 });

      // No role → no "Users" link in sidebar
      const usersLink = page.getByRole("link", { name: /^Users$/i });
      await expect(usersLink).not.toBeVisible();

      // Ensure realtime subscription is set up (AuthContext useEffect runs after render)
      // Add small delay to let realtime listener register
      await page.waitForTimeout(500);

      // Promote to admin via API (simulates admin action in another tab/session)
      await patchUser(tempUserId, { role: "admin" });

      // Wait for realtime subscription to trigger authRefresh and re-render
      await expect(usersLink).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      // Cleanup
      await deleteTestUser(tempUserId).catch(() => {});
    }
  });

  test("role revoked from admin propagates to live session within 3 s", async ({ page }) => {
    // Create a unique temp admin user for this test
    const adminEmail = `rt-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-revoke@kit.local`;
    const adminUser = await createTestUser(adminEmail, "admin");
    const tempUserId = adminUser.id;

    try {
      // Log in as the temp admin user
      await page.goto("/login");
      await page.getByLabel("Email").fill(adminEmail);
      await page.getByLabel("Password").fill(tempPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard", { timeout: 10_000 });

      // Admin → "Users" link should be visible
      await expect(page.getByRole("link", { name: /^Users$/i })).toBeVisible();

      // Demote to plain user via API
      await patchUser(tempUserId, { role: "user" });

      // Wait for realtime subscription to trigger authRefresh; Users link disappears
      await expect(page.getByRole("link", { name: /^Users$/i })).not.toBeVisible({
        timeout: 5_000,
      });
    } finally {
      // Cleanup
      await deleteTestUser(tempUserId).catch(() => {});
    }
  });
});

// Verify the PB_URL used by helpers is reachable (fast fail if env is wrong)
test("PocketBase health check for realtime tests", async () => {
  const res = await fetch(`${PB_URL}/api/health`);
  expect(res.ok).toBe(true);
});
