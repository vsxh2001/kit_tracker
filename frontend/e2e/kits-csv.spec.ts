/**
 * CSV import + export for the kits collection.
 *
 * Coverage:
 *   - Export round-trip: download contains header row + seeded kit data
 *   - Import happy path: 2 unique serials → Imported: 2
 *   - Import duplicate skip: 1 new + 1 existing → Imported: 1, Skipped: 1
 *   - Import error: empty serial in row 2 → error with row number
 *   - Permission gate: user/viewer do NOT see Import/Export buttons
 */

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  deleteKit,
  getKitBySerial,
} from "./helpers/api";

const TS = `csv-${Date.now()}`;

// ---------------------------------------------------------------------------
// Export round-trip
// ---------------------------------------------------------------------------

test.describe("CSV export", () => {
  let kitId: string;
  const SERIAL = `${TS}-EXP`;

  test.beforeAll(async () => {
    const kit = await createTestKit(SERIAL, "export test kit");
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("admin export downloads CSV with header row and seeded kit", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^kits-\d{4}-\d{2}-\d{2}\.csv$/);

    const savePath = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(savePath);

    const content = fs.readFileSync(savePath, "utf-8");
    const lines = content.trim().split("\n");

    // Header row
    expect(lines[0]).toContain("serial");
    expect(lines[0]).toContain("notes");
    expect(lines[0]).toContain("is_active");
    expect(lines[0]).toContain("created");
    expect(lines[0]).toContain("current_holder");

    // At least one data row
    expect(lines.length).toBeGreaterThan(1);

    // Seeded kit appears
    expect(content).toContain(SERIAL);

    fs.unlinkSync(savePath);
  });
});

// ---------------------------------------------------------------------------
// Import happy path
// ---------------------------------------------------------------------------

test.describe("CSV import — happy path", () => {
  const SERIAL_A = `${TS}-IMP-A`;
  const SERIAL_B = `${TS}-IMP-B`;

  test.afterAll(async () => {
    const a = await getKitBySerial(SERIAL_A);
    if (a) await deleteKit(a.id);
    const b = await getKitBySerial(SERIAL_B);
    if (b) await deleteKit(b.id);
  });

  test("importing 2 unique serials shows Imported: 2", async ({ page }) => {
    const csv = `serial,notes,is_active\n${SERIAL_A},note a,true\n${SERIAL_B},note b,true\n`;
    const tmpPath = path.join(os.tmpdir(), `import-happy-${TS}.csv`);
    fs.writeFileSync(tmpPath, csv);

    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByRole("button", { name: /import csv/i }).click();
    await expect(
      page.getByRole("dialog", { name: /import kits/i })
    ).toBeVisible();

    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(tmpPath);
    await page.getByRole("button", { name: /^import$/i }).click();

    // Wait for result
    await expect(page.getByText(/imported:/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/imported:\s*2/i)).toBeVisible();
    await expect(page.getByText(/skipped:\s*0/i)).toBeVisible();
    await expect(page.getByText(/errors:\s*0/i)).toBeVisible();

    // Scope to dialog to avoid matching the Radix X-button (also labelled "Close")
    await page.getByRole("dialog").getByRole("button", { name: /^close$/i }).first().click();

    // Both kits should appear in the table after reload
    await page.getByPlaceholder(/search by serial/i).fill(SERIAL_A);
    await expect(page.getByRole("cell", { name: SERIAL_A })).toBeVisible();

    await page.getByPlaceholder(/search by serial/i).fill(SERIAL_B);
    await expect(page.getByRole("cell", { name: SERIAL_B })).toBeVisible();

    fs.unlinkSync(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// Import duplicate skip
// ---------------------------------------------------------------------------

test.describe("CSV import — duplicate skip", () => {
  let existingKitId: string;
  const EXISTING_SERIAL = `${TS}-DUP-EXIST`;
  const NEW_SERIAL = `${TS}-DUP-NEW`;

  test.beforeAll(async () => {
    const kit = await createTestKit(EXISTING_SERIAL);
    existingKitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(existingKitId);
    const newKit = await getKitBySerial(NEW_SERIAL);
    if (newKit) await deleteKit(newKit.id);
  });

  test("1 new + 1 existing shows Imported: 1, Skipped: 1 with serial name", async ({
    page,
  }) => {
    const csv = `serial,notes,is_active\n${NEW_SERIAL},,true\n${EXISTING_SERIAL},,true\n`;
    const tmpPath = path.join(os.tmpdir(), `import-dup-${TS}.csv`);
    fs.writeFileSync(tmpPath, csv);

    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByRole("button", { name: /import csv/i }).click();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(tmpPath);
    await page.getByRole("button", { name: /^import$/i }).click();

    await expect(page.getByText(/imported:/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/imported:\s*1/i)).toBeVisible();
    await expect(page.getByText(/skipped:\s*1/i)).toBeVisible();

    // Skipped list shows the existing serial — scope to dialog to avoid matching table rows
    await expect(page.getByRole("dialog").getByText(EXISTING_SERIAL)).toBeVisible();

    // Scope to dialog to avoid matching the Radix X-button (also labelled "Close")
    await page.getByRole("dialog").getByRole("button", { name: /^close$/i }).first().click();
    fs.unlinkSync(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// Import error — empty serial
// ---------------------------------------------------------------------------

test.describe("CSV import — error on empty serial", () => {
  const VALID_SERIAL = `${TS}-ERR-VALID`;

  test.afterAll(async () => {
    const kit = await getKitBySerial(VALID_SERIAL);
    if (kit) await deleteKit(kit.id);
  });

  test("empty serial in row 2 reports error with row number", async ({
    page,
  }) => {
    // Row 2 (data row 1) has empty serial; row 3 is valid
    const csv = `serial,notes,is_active\n,,true\n${VALID_SERIAL},,true\n`;
    const tmpPath = path.join(os.tmpdir(), `import-err-${TS}.csv`);
    fs.writeFileSync(tmpPath, csv);

    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByRole("button", { name: /import csv/i }).click();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(tmpPath);
    await page.getByRole("button", { name: /^import$/i }).click();

    await expect(page.getByText(/errors:\s*1/i)).toBeVisible({ timeout: 10_000 });

    // Should mention row 2
    await expect(page.getByText(/row 2/i)).toBeVisible();

    // Scope to dialog to avoid matching the Radix X-button (also labelled "Close")
    await page.getByRole("dialog").getByRole("button", { name: /^close$/i }).first().click();
    fs.unlinkSync(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// Permission gate
// ---------------------------------------------------------------------------

test.describe("CSV permission gate", () => {
  test("user role does NOT see Import or Export buttons", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /export csv/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /import csv/i })
    ).not.toBeVisible();
  });

  test("viewer role does NOT see Import or Export buttons", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /export csv/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /import csv/i })
    ).not.toBeVisible();
  });
});
