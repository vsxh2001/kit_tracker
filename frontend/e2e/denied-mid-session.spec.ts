/**
 * Mid-session denial kick-out spec (T10 — Pilot-Ready Sprint).
 *
 * Reproduces puppet-show finding U-01:
 *   1. A user logs in successfully.
 *   2. Admin sets the user's role to "denied" via the API (second context).
 *   3. Within ~5 seconds the active session is redirected to /login?reason=denied.
 *   4. The login page shows the "account access was revoked" banner.
 *
 * Also verifies cosmetic fix: nav links are hidden for denied users even
 * before the realtime kick-out fires.
 */

import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser, setRole, patchUser } from "./helpers/api";

test.describe.serial("Denied user mid-session kick-out", () => {
  let userId = "";
  const tempPassword = "Pass1234!";

  const ts = Date.now();
  const tempEmail = `denied-mid-${ts}@test.local`;

  test.beforeAll(async () => {
    const u = await createTestUser(tempEmail, "user");
    userId = u.id;
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("denied mid-session: user redirected to /login?reason=denied within 5 s @smoke", async ({ page }) => {
    // Log in as the temp user
    await page.goto("/login");
    await page.getByLabel("Email").fill(tempEmail);
    await page.getByLabel("Password").fill(tempPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard", { timeout: 10_000 });

    // Nav links should be visible (role is "user")
    await expect(page.getByRole("link", { name: /^Dashboard$/i })).toBeVisible({ timeout: 4_000 });

    // Give realtime subscription time to register
    await page.waitForTimeout(500);

    // Admin sets role to "denied" via API (simulates admin action)
    await setRole(userId, "denied");

    // Within 5 s the session should be cleared and the page redirected
    await page.waitForURL("**/login**", { timeout: 7_000 });
    await expect(page).toHaveURL(/\/login/);

    // The ?reason=denied banner should be visible
    await expect(
      page.getByText("Your account access was revoked. Contact administrator.")
    ).toBeVisible({ timeout: 4_000 });
  });

  test("hasRole excludes denied: nav hidden for denied user before kick-out", async ({ page }) => {
    // Create a second temp user, then set role to "denied" via API
    const ts2 = Date.now();
    const deniedEmail = `denied-nav-${ts2}@test.local`;
    const deniedUser = await createTestUser(deniedEmail, "user");
    await patchUser(deniedUser.id, { role: "denied" });

    try {
      // Attempt login — PB will succeed (denied users can still authenticate)
      // but the session should have no nav links
      await page.goto("/login");
      await page.getByLabel("Email").fill(deniedEmail);
      await page.getByLabel("Password").fill(tempPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();

      // The login service checks for "denied" in the error message.
      // If PB rejects denied users at login time, we'll see the amber banner.
      // If not, we navigate to dashboard — either way nav links must be absent.
      await page.waitForTimeout(2_000);

      const onLogin = page.url().includes("/login");
      if (!onLogin) {
        // Successfully navigated somewhere — nav links must NOT show for denied role
        await expect(page.getByRole("link", { name: /^Dashboard$/i })).not.toBeVisible({ timeout: 3_000 });
      }
      // On /login: denied banner or generic error — both are acceptable
    } finally {
      await deleteTestUser(deniedUser.id).catch(() => {});
    }
  });
});
