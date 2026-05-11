/**
 * CSV import + export for the entities collection.
 *
 * Coverage:
 *   - Export round-trip: download contains header row + seeded entity data
 *   - Import happy path: 2 unique names → Imported: 2
 *   - Import duplicate skip: 1 new + 1 existing → Imported: 1, Skipped: 1
 *   - Import error: empty name in row 2 → error with row number
 *   - Permission gate: user/viewer do NOT see Import/Export buttons
 */

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { loginAs } from "./helpers/auth";
import {
  createTestEntity,
  deleteEntityRecord,
  getEntityByName,
} from "./helpers/api";

const TS = `ecsv-${Date.now()}`;

// ---------------------------------------------------------------------------
// Export round-trip
// ---------------------------------------------------------------------------

test.describe("Entities CSV export", () => {
  let entityId: string;
  const NAME = `${TS}-EXP`;

  test.beforeAll(async () => {
    const entity = await createTestEntity(NAME, "export test entity");
    entityId = entity.id;
  });

  test.afterAll(async () => {
    await deleteEntityRecord(entityId);
  });

  test("admin export downloads CSV with header row and seeded entity @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^entities-\d{4}-\d{2}-\d{2}\.csv$/);

    const savePath = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(savePath);

    const content = fs.readFileSync(savePath, "utf-8");
    const lines = content.trim().split("\n");

    // Header row
    expect(lines[0]).toContain("name");
    expect(lines[0]).toContain("description");
    expect(lines[0]).toContain("is_active");
    expect(lines[0]).toContain("created");

    // At least one data row
    expect(lines.length).toBeGreaterThan(1);

    // Seeded entity appears
    expect(content).toContain(NAME);

    fs.unlinkSync(savePath);
  });
});

// ---------------------------------------------------------------------------
// Import happy path
// ---------------------------------------------------------------------------

test.describe("Entities CSV import — happy path", () => {
  const NAME_A = `${TS}-IMP-A`;
  const NAME_B = `${TS}-IMP-B`;

  test.afterAll(async () => {
    const a = await getEntityByName(NAME_A);
    if (a) await deleteEntityRecord(a.id);
    const b = await getEntityByName(NAME_B);
    if (b) await deleteEntityRecord(b.id);
  });

  test("importing 2 unique names shows Imported: 2", async ({ page }) => {
    const csv = `name,description,type,is_active\n${NAME_A},desc a,storage,true\n${NAME_B},desc b,storage,true\n`;
    const tmpPath = path.join(os.tmpdir(), `import-ent-happy-${TS}.csv`);
    fs.writeFileSync(tmpPath, csv);

    await loginAs(page, "admin");
    await page.goto("/entities");

    await page.getByRole("button", { name: /import csv/i }).click();
    await expect(
      page.getByRole("dialog", { name: /import entities/i })
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

    fs.unlinkSync(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// Import duplicate skip
// ---------------------------------------------------------------------------

test.describe("Entities CSV import — duplicate skip", () => {
  let existingEntityId: string;
  const EXISTING_NAME = `${TS}-DUP-EXIST`;
  const NEW_NAME = `${TS}-DUP-NEW`;

  test.beforeAll(async () => {
    const entity = await createTestEntity(EXISTING_NAME);
    existingEntityId = entity.id;
  });

  test.afterAll(async () => {
    await deleteEntityRecord(existingEntityId);
    const newEntity = await getEntityByName(NEW_NAME);
    if (newEntity) await deleteEntityRecord(newEntity.id);
  });

  test("1 new + 1 existing shows Imported: 1, Skipped: 1 with entity name", async ({
    page,
  }) => {
    const csv = `name,description,type,is_active\n${NEW_NAME},,storage,true\n${EXISTING_NAME},,storage,true\n`;
    const tmpPath = path.join(os.tmpdir(), `import-ent-dup-${TS}.csv`);
    fs.writeFileSync(tmpPath, csv);

    await loginAs(page, "admin");
    await page.goto("/entities");

    await page.getByRole("button", { name: /import csv/i }).click();
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(tmpPath);
    await page.getByRole("button", { name: /^import$/i }).click();

    await expect(page.getByText(/imported:/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/imported:\s*1/i)).toBeVisible();
    await expect(page.getByText(/skipped:\s*1/i)).toBeVisible();

    // Skipped list shows the existing name — scope to dialog
    await expect(page.getByRole("dialog").getByText(EXISTING_NAME)).toBeVisible();

    // Scope to dialog to avoid matching the Radix X-button (also labelled "Close")
    await page.getByRole("dialog").getByRole("button", { name: /^close$/i }).first().click();
    fs.unlinkSync(tmpPath);
  });
});

// ---------------------------------------------------------------------------
// Import error — empty name
// ---------------------------------------------------------------------------

test.describe("Entities CSV import — error on empty name", () => {
  const VALID_NAME = `${TS}-ERR-VALID`;

  test.afterAll(async () => {
    const entity = await getEntityByName(VALID_NAME);
    if (entity) await deleteEntityRecord(entity.id);
  });

  test("empty name in row 2 reports error with row number", async ({
    page,
  }) => {
    // Row 2 (data row 1) has empty name; row 3 is valid
    const csv = `name,description,type,is_active\n,,storage,true\n${VALID_NAME},,storage,true\n`;
    const tmpPath = path.join(os.tmpdir(), `import-ent-err-${TS}.csv`);
    fs.writeFileSync(tmpPath, csv);

    await loginAs(page, "admin");
    await page.goto("/entities");

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

test.describe("Entities CSV permission gate", () => {
  test("user role does NOT see Import or Export buttons", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /export csv/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /import csv/i })
    ).not.toBeVisible();
  });

  test("viewer role does NOT see Import or Export buttons", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /export csv/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /import csv/i })
    ).not.toBeVisible();
  });
});
