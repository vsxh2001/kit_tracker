/**
 * E2E tests for the /audit page.
 *
 * Test 1 (@smoke): Admin sees Audit nav link + page renders;
 *   after creating/updating a kit via API, new audit entries appear.
 * Test 2: Non-admin (user/viewer) does NOT see nav link;
 *   direct /audit navigation redirects to dashboard.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  deleteKit,
  getAdminToken,
} from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// ---------------------------------------------------------------------------
// Test 1 — Admin sees Audit link + page shows audit entries
// ---------------------------------------------------------------------------

test.describe("Audit UI — admin access", () => {
  let kitId: string;
  const TS = `audit-ui-${Date.now()}`;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-KIT`, "initial-notes");
    kitId = kit.id;

    // Update the kit to produce an update audit entry
    const token = await getAdminToken();
    await fetch(`${PB_URL}/api/collections/kits/records/${kitId}`, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "updated-notes" }),
    });

    // Brief wait for hook to write audit rows
    await new Promise((r) => setTimeout(r, 300));
  });

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("admin sees Audit nav link and audit entries load @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    // Nav link visible
    await expect(
      page.getByRole("link", { name: "Audit" }),
      "Admin must see Audit nav link"
    ).toBeVisible();

    // Navigate to /audit
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/audit/);

    // Wait for loading to finish (skeletons gone)
    await expect(
      page.locator(".animate-pulse").first()
    ).not.toBeVisible({ timeout: 8_000 });

    // Page heading
    await expect(
      page.getByRole("heading", { name: "Audit Log" })
    ).toBeVisible();

    // Reload to pick up the freshly written audit entries
    await page.reload();
    await expect(
      page.locator(".animate-pulse").first()
    ).not.toBeVisible({ timeout: 8_000 });

    // Expect at least one row for the kit we created/updated
    // The table contains the serial in the record_id column, or we check for action badges
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 8_000 });

    // Collection filter chips visible — use first() to resolve strict-mode violations
    // The filter chips appear before the table content
    await expect(page.getByRole("button", { name: "Kits" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Entities" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Users" }).first()).toBeVisible();

    // Action filter chips visible
    await expect(page.getByRole("button", { name: "Create" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Update" }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Non-admin cannot see Audit link or page
// ---------------------------------------------------------------------------

test.describe("Audit UI — non-admin access control", () => {
  test("viewer does not see Audit nav link and is redirected from /audit", async ({ page }) => {
    await loginAs(page, "viewer");

    // Nav link not visible
    await expect(
      page.getByRole("link", { name: "Audit" }),
      "Viewer must NOT see Audit nav link"
    ).not.toBeVisible();

    // Direct navigation redirects to dashboard
    await page.goto("/audit");
    await page.waitForURL("**/dashboard", { timeout: 8_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("user role does not see Audit nav link and is redirected from /audit", async ({ page }) => {
    await loginAs(page, "user");

    await expect(
      page.getByRole("link", { name: "Audit" }),
      "User must NOT see Audit nav link"
    ).not.toBeVisible();

    await page.goto("/audit");
    await page.waitForURL("**/dashboard", { timeout: 8_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
