/**
 * stats.spec.ts
 *
 * Coverage:
 *   1. Admin sees /stats nav link + page renders all 6 cards (@smoke)
 *   2. User (non-admin/non-technician) does NOT see /stats nav link;
 *      direct navigation redirects to dashboard
 *   3. Numbers populate correctly when seeded data exists (total kits matches API)
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit, getAdminToken } from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

test.describe("Stats page — admin access", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("admin sees Stats nav link and all 6 cards render @smoke", async ({ page }) => {
    // Sidebar link visible
    await expect(page.getByRole("link", { name: "Stats" })).toBeVisible();

    await page.goto("/stats");

    // Page heading
    await expect(page.getByRole("heading", { name: "Utilization" })).toBeVisible();

    // All 6 cards present via data-testid
    await expect(page.locator('[data-testid="card-utilization"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-top-requesters"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-top-kits"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-status-breakdown"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-overdue"]')).toBeVisible();
    await expect(page.locator('[data-testid="card-avg-fulfillment"]')).toBeVisible();
  });
});

test.describe("Stats page — permission gate", () => {
  test("viewer does NOT see Stats nav link and is redirected from /stats", async ({ page }) => {
    await loginAs(page, "viewer");

    // Sidebar: no Stats link
    await expect(page.getByRole("link", { name: "Stats" })).not.toBeVisible();

    // Direct navigation redirects to dashboard
    await page.goto("/stats");
    await page.waitForURL("**/dashboard", { timeout: 8_000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  test("user does NOT see Stats nav link and is redirected from /stats", async ({ page }) => {
    await loginAs(page, "user");

    // Sidebar: no Stats link
    await expect(page.getByRole("link", { name: "Stats" })).not.toBeVisible();

    // Direct navigation redirects to dashboard
    await page.goto("/stats");
    await page.waitForURL("**/dashboard", { timeout: 8_000 });
    await expect(page).toHaveURL(/dashboard/);
  });
});

test.describe("Stats page — data smoke check", () => {
  const TS = `stats-${Date.now()}`;
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-KIT`, "stats test kit");
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("total kits on /stats matches active kit count from API", async ({ page }) => {
    // Fetch active kit count from API
    const token = await getAdminToken();
    const res = await fetch(
      `${PB_URL}/api/collections/kits/records?filter=is_active%3Dtrue&perPage=1`,
      { headers: { Authorization: token } }
    );
    const data = await res.json();
    const apiTotal: number = data.totalItems ?? 0;

    await loginAs(page, "admin");
    await page.goto("/stats");

    // Wait for card to be present and loaded (not skeleton)
    await expect(page.locator('[data-testid="card-utilization"]')).toBeVisible();

    // The utilization card shows "N total kits" text
    await expect(
      page.locator('[data-testid="card-utilization"]').getByText(`${apiTotal} total kits`)
    ).toBeVisible({ timeout: 10_000 });
  });
});
