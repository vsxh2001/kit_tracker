/**
 * Kit tags feature.
 *
 * Coverage:
 *   - Admin creates kit with tags → tag chips visible in table row (sorted)
 *   - Tag filter chip — click filters table to matching kits only
 *   - Tag normalization — duplicate/mixed-case/whitespace → stored deduped lowercase
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit, getKitBySerial } from "./helpers/api";

const TS = `tags-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1: admin creates kit with tags, chips visible sorted
// ---------------------------------------------------------------------------

test.describe("Kit tags — create with tags", () => {
  let kitId: string;

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("admin creates kit with tags and chips appear sorted @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    // Open new kit dialog
    await page.getByRole("button", { name: /new kit/i }).click();
    await page.getByLabel("Serial").fill(`${TS}-CREATE`);
    await page.getByLabel(/tags/i).fill("laptop, ssd, dell");
    await page.getByRole("button", { name: "Save" }).click();

    // Wait for success toast / dialog to close
    await expect(page.getByText("Kit created", { exact: true })).toBeVisible();

    // Re-navigate to ensure fresh data
    await page.goto("/kits");

    // Search for the specific kit
    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-CREATE`);

    // All three tags should be visible in the row (sorted: dell, laptop, ssd)
    await expect(page.getByText("dell").first()).toBeVisible();
    await expect(page.getByText("laptop").first()).toBeVisible();
    await expect(page.getByText("ssd").first()).toBeVisible();

    // Verify sorted order in DOM: dell before laptop before ssd
    const tagSpans = page.locator("table span").filter({ hasText: /^(dell|laptop|ssd)$/ });
    const texts = await tagSpans.allTextContents();
    const kitTags = texts.filter(t => ["dell", "laptop", "ssd"].includes(t));
    expect(kitTags).toEqual(["dell", "laptop", "ssd"]);

    // Capture kit id for cleanup
    const kitRecord = await getKitBySerial(`${TS}-CREATE`);
    if (kitRecord) kitId = kitRecord.id;
  });
});

// ---------------------------------------------------------------------------
// Test 2: tag filter chip — click shows only matching kits
// ---------------------------------------------------------------------------

test.describe("Kit tags — filter by tag", () => {
  let kitWithTagId: string;
  let kitWithoutTagId: string;

  test.beforeAll(async () => {
    // Kit with the filter tag
    const k1 = await createTestKit(`${TS}-FILT-TAG`);
    kitWithTagId = k1.id;
    // Patch tags via admin API
    const { getAdminToken } = await import("./helpers/api");
    const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
    const token = await getAdminToken();
    await fetch(`${PB_URL}/api/collections/kits/records/${kitWithTagId}`, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ tags: "filterable" }),
    });

    // Kit without the filter tag
    const k2 = await createTestKit(`${TS}-FILT-NOTAG`);
    kitWithoutTagId = k2.id;
  });

  test.afterAll(async () => {
    if (kitWithTagId) await deleteKit(kitWithTagId);
    if (kitWithoutTagId) await deleteKit(kitWithoutTagId);
  });

  test("clicking tag filter chip shows only kits with that tag", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    // Wait for kits to load
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();

    // The "filterable" tag chip should appear
    const tagChip = page.getByRole("button", { name: "filterable" });
    await expect(tagChip).toBeVisible();

    // Click the chip to activate filter
    await tagChip.click();

    // Kit with tag should be visible, kit without should not
    await expect(page.getByRole("cell", { name: `${TS}-FILT-TAG`, exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: `${TS}-FILT-NOTAG`, exact: true })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 3: tag normalization — dedup + trim + lowercase
// ---------------------------------------------------------------------------

test.describe("Kit tags — normalization", () => {
  let kitId: string;

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("duplicate/mixed-case/whitespace tags stored deduped lowercase", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByRole("button", { name: /new kit/i }).click();
    await page.getByLabel("Serial").fill(`${TS}-NORM`);
    await page.getByLabel(/tags/i).fill("  Laptop , SSD , laptop  ");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Kit created", { exact: true })).toBeVisible();

    // Fetch the stored record and verify tags field
    const kitRecord = await getKitBySerial(`${TS}-NORM`);
    expect(kitRecord).not.toBeNull();
    kitId = kitRecord!.id;

    // Fetch full record to check tags
    const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
    const { getAdminToken } = await import("./helpers/api");
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/collections/kits/records/${kitId}`, {
      headers: { Authorization: token },
    });
    const data = await res.json();

    // Should be deduped, lowercased: "laptop,ssd" (order from Set iteration)
    expect(data.tags).toBe("laptop,ssd");
  });
});
