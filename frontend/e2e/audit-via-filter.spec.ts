/**
 * Audit log — via source filter tests.
 *
 * Verifies the Source dropdown on /audit narrows rows by changes.via value.
 */

import { test, expect } from "@playwright/test";
import { seedAuditRows } from "./helpers/api";

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:5173";

test.describe("Audit log — via source filter @smoke", () => {
  test.beforeAll(async () => {
    await seedAuditRows([
      { via: "web", action: "create", collection_name: "kits" },
      { via: "wa-bot", action: "update", collection_name: "kits" },
      { via: "mcp", action: "create", collection_name: "entities" },
    ]);
  });

  test("all 3 seeded rows visible, filter by WhatsApp, then reset", async ({ page }) => {
    // Login as admin
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill("logistics@kit.local");
    await page.getByLabel("Password").fill("Pass1234!");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(dashboard|$)/);

    // Navigate to /audit
    await page.goto(`${BASE_URL}/audit`);
    await page.waitForLoadState("networkidle");

    // All 3 seeded rows should be present (table may have more rows from other tests)
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();

    // Find rows containing "Web", "WhatsApp", "MCP" in the Source column
    const webRow = rows.filter({ hasText: "Web" });
    const waRow = rows.filter({ hasText: "WhatsApp" });
    const mcpRow = rows.filter({ hasText: "MCP" });

    await expect(webRow.first()).toBeVisible();
    await expect(waRow.first()).toBeVisible();
    await expect(mcpRow.first()).toBeVisible();

    // Select "WhatsApp" from the Source dropdown
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "WhatsApp" }).click();

    // Wait for filter to apply
    await page.waitForTimeout(200);

    // Only WhatsApp rows visible; Web and MCP rows should be gone
    await expect(waRow.first()).toBeVisible();
    await expect(rows.filter({ hasText: "Web" })).toHaveCount(0);
    await expect(rows.filter({ hasText: "MCP" })).toHaveCount(0);

    // Select "All sources" → all 3 visible again
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "All sources" }).click();

    await page.waitForTimeout(200);

    await expect(rows.filter({ hasText: "Web" }).first()).toBeVisible();
    await expect(rows.filter({ hasText: "WhatsApp" }).first()).toBeVisible();
    await expect(rows.filter({ hasText: "MCP" }).first()).toBeVisible();
  });
});
