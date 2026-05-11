/**
 * QR code feature smoke tests.
 *
 * Coverage:
 *   1. KitDetailPage renders a QR code SVG (aria-label check)
 *   2. /kits shows "Print labels" button for admin, not for user/viewer
 *   3. /kits/print renders grid with the seeded kit count
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  deleteKit,
} from "./helpers/api";

const TS = `qr-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1: KitDetailPage has QR
// ---------------------------------------------------------------------------

test.describe("KitDetailPage QR code", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-QR`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("detail page renders QR SVG with aria-label @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    // Wait for the detail card to load
    await expect(page.getByText("Details")).toBeVisible();
    // QR container has aria-label
    const qrContainer = page.locator('[aria-label="QR code for this kit"]');
    await expect(qrContainer).toBeVisible();
    // SVG inside the container
    await expect(qrContainer.locator("svg")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 2: "Print labels" button visibility by role
// ---------------------------------------------------------------------------

test.describe("Print labels button visibility", () => {
  test("admin sees Print labels link on /kits", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await expect(page.getByRole("link", { name: /print labels/i })).toBeVisible();
  });

  test("user does not see Print labels link on /kits", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/kits");
    await expect(page.getByRole("link", { name: /print labels/i })).not.toBeVisible();
  });

  test("viewer does not see Print labels link on /kits", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/kits");
    await expect(page.getByRole("link", { name: /print labels/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 3: /kits/print renders grid with kit labels
// ---------------------------------------------------------------------------

test.describe("/kits/print page", () => {
  const SERIALS = [`${TS}-PRINT-A`, `${TS}-PRINT-B`];
  const kitIds: string[] = [];

  test.beforeAll(async () => {
    for (const serial of SERIALS) {
      const kit = await createTestKit(serial);
      kitIds.push(kit.id);
    }
  });

  test.afterAll(async () => {
    for (const id of kitIds) {
      await deleteKit(id);
    }
  });

  test("renders label grid with expected kit serials", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits/print");
    // Print button is visible
    await expect(page.getByRole("button", { name: /print/i })).toBeVisible();
    // Grid is present
    const grid = page.locator('[data-testid="labels-grid"]');
    await expect(grid).toBeVisible();
    // Our seeded kits appear in the grid
    for (const serial of SERIALS) {
      await expect(page.getByText(serial)).toBeVisible();
    }
  });
});
