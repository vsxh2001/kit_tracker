/**
 * Audit log — via source filter tests.
 *
 * Verifies the Source dropdown on /audit narrows rows by changes.via value.
 */

import * as path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { seedAuditRows } from "./helpers/api";

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:5173";

test.describe("Audit log — CSV export @smoke", () => {
  test.beforeAll(async () => {
    await seedAuditRows([
      { via: "web", action: "create", collection_name: "kits" },
    ]);
  });

  test("Export CSV button triggers download with correct filename", async ({ page }) => {
    // Login as admin
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill("logistics@kit.local");
    await page.getByLabel("Password").fill("Pass1234!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/(dashboard|$)/);

    // Navigate to /audit
    await page.goto(`${BASE_URL}/audit`);
    // waitForLoadState("networkidle") hangs on /audit due to PB SSE realtime subscription.
    // Wait for the page heading first, then for data to actually load — the
    // heading appears before fetch completes, so on slower (dockerized) CI
    // runners the export would otherwise fire against an empty entry list and
    // produce a header-only CSV that fails the data-row assertion below.
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Showing \d+ of \d+ entries/)).toBeVisible({ timeout: 10_000 });

    // Start waiting for download before clicking
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;

    // Filename matches audit-log-YYYY-MM-DD-HHMM.csv
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);

    // Read the file and verify content
    const savePath = path.join("/tmp", filename);
    await download.saveAs(savePath);
    const content = readFileSync(savePath, "utf-8");
    expect(content.startsWith("﻿")).toBe(true); // UTF-8 BOM
    expect(content).toContain('"Created","Collection"'); // header row (csvCell wraps each column in quotes)
    expect(content.split("\r\n").length).toBeGreaterThan(1); // at least header + one data row
  });
});

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
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/(dashboard|$)/);

    // Navigate to /audit
    await page.goto(`${BASE_URL}/audit`);
    // waitForLoadState("networkidle") hangs on /audit due to PB SSE realtime subscription.
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({ timeout: 10_000 });
    // Wait for data load — the heading shows before fetch completes; on slow
    // CI runners the row assertions below would race against an empty list.
    await expect(page.getByText(/Showing \d+ of \d+ entries/)).toBeVisible({ timeout: 10_000 });

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
