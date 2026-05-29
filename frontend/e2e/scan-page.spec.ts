/**
 * ScanPage smoke tests — public QR scan landing page (/scan/:kitId).
 *
 * Coverage:
 *   1. Valid kit with no transactions → serial shown, holder "Unassigned"
 *   2. Valid kit with a transaction → holder entity name shown
 *   3. Valid kit with notes → notes section rendered
 *   4. Unknown kitId → "Kit not found" card
 *
 * Auth: none required — navigates without logging in (page is public).
 */

import { test, expect } from "@playwright/test";
import {
  createTestKit,
  deleteKit,
  createTestEntity,
  deleteEntityRecord,
  createTestTransaction,
} from "./helpers/api";

const TS = `scan-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1: valid kit, no transactions → serial + "Unassigned" holder
// ---------------------------------------------------------------------------

test.describe("ScanPage — no holder", () => {
  let kit: { id: string; serial: string };

  test.beforeAll(async () => {
    kit = await createTestKit(`${TS}-A`);
  });

  test.afterAll(async () => {
    await deleteKit(kit.id);
  });

  test("shows serial and Unassigned when kit has no transactions @smoke", async ({ page }) => {
    await page.goto(`/scan/${kit.serial}`);
    await expect(page.getByRole("heading", { name: kit.serial })).toBeVisible();
    await expect(page.getByText("Unassigned")).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 2: valid kit with a transaction → holder entity name shown
// ---------------------------------------------------------------------------

test.describe("ScanPage — with holder", () => {
  let kit: { id: string; serial: string };
  let entity: { id: string; name: string };

  test.beforeAll(async () => {
    kit = await createTestKit(`${TS}-B`);
    entity = await createTestEntity(`${TS}-Unit`);
    await createTestTransaction({ kitId: kit.id, toEntityId: entity.id });
  });

  test.afterAll(async () => {
    await deleteKit(kit.id);
    await deleteEntityRecord(entity.id);
  });

  test("shows entity name as current holder @smoke", async ({ page }) => {
    await page.goto(`/scan/${kit.serial}`);
    await expect(page.getByRole("heading", { name: kit.serial })).toBeVisible();
    await expect(page.getByText(`${TS}-Unit`)).toBeVisible();
    await expect(page.getByText("Unassigned")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 3: valid kit with notes → notes section rendered
// ---------------------------------------------------------------------------

test.describe("ScanPage — kit with notes", () => {
  const NOTES = "fragile — handle with care";
  let kit: { id: string; serial: string };

  test.beforeAll(async () => {
    kit = await createTestKit(`${TS}-C`, NOTES);
  });

  test.afterAll(async () => {
    await deleteKit(kit.id);
  });

  test("renders notes section when kit has notes @smoke", async ({ page }) => {
    await page.goto(`/scan/${kit.serial}`);
    await expect(page.getByRole("heading", { name: kit.serial })).toBeVisible();
    await expect(page.getByText(NOTES)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 4: unknown serial → "Kit not found" card
// ---------------------------------------------------------------------------

test.describe("ScanPage — not found", () => {
  test("shows Kit not found for unknown serial @smoke", async ({ page }) => {
    await page.goto("/scan/NONEXISTENT-SCAN-SERIAL-XYZ");
    await expect(page.getByText(/kit not found/i)).toBeVisible();
    await expect(page.getByText(/retired or the QR code may be outdated/i)).toBeVisible();
  });
});
