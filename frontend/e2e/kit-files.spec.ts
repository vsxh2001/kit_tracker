/**
 * Kit file attachments feature.
 *
 * Coverage:
 *   1. Admin uploads a file to a kit → file appears in list
 *   2. Admin deletes attachment → file gone from list
 *   3. Viewer sees attachments list but NO upload/delete buttons
 */

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit } from "./helpers/api";

const TS = `files-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1: admin uploads a file → appears in list
// ---------------------------------------------------------------------------

test.describe("Kit files — upload", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-UPLOAD`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("admin uploads a file to a kit and it appears in the list @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Wait for the Attachments card to appear
    await expect(page.getByText("Attachments", { exact: true }).first()).toBeVisible();

    // Create a temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `test-attach-${TS}.txt`);
    fs.writeFileSync(tmpFile, "kit attachment test content");

    // Trigger file upload via hidden input
    const fileInput = page.locator('[data-testid="attachment-file-input"]');
    await fileInput.setInputFiles(tmpFile);

    // Wait for upload success toast
    await expect(page.getByText("File uploaded", { exact: true })).toBeVisible({ timeout: 10_000 });

    // The filename should appear as a link
    await expect(page.locator(`[data-testid^="attachment-link-"]`).first()).toBeVisible();

    // Clean up temp file
    fs.unlinkSync(tmpFile);
  });
});

// ---------------------------------------------------------------------------
// Test 2: admin deletes attachment → gone from list
// ---------------------------------------------------------------------------

test.describe("Kit files — delete", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-DELETE`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("admin uploads then deletes attachment, file gone from list @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    await expect(page.getByText("Attachments", { exact: true }).first()).toBeVisible();

    // Upload a file first
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `test-delete-${TS}.txt`);
    fs.writeFileSync(tmpFile, "to be deleted");

    const fileInput = page.locator('[data-testid="attachment-file-input"]');
    await fileInput.setInputFiles(tmpFile);

    // Wait for file to appear
    await expect(page.locator('[data-testid^="attachment-link-"]').first()).toBeVisible({ timeout: 10_000 });

    // Click the delete button for the first attachment
    const deleteBtn = page.locator('[data-testid^="attachment-delete-"]').first();
    await deleteBtn.click();

    // Confirm delete in AlertDialog
    const confirmDeleteBtn = page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true });
    await confirmDeleteBtn.click();

    // Wait for delete success toast
    await expect(page.getByText("Attachment deleted", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Attachment link should no longer be visible
    await expect(page.locator('[data-testid^="attachment-link-"]')).toHaveCount(0);

    fs.unlinkSync(tmpFile);
  });
});

// ---------------------------------------------------------------------------
// Test 3: attachment links include file token; raw URL without token → 403
// ---------------------------------------------------------------------------

test.describe("Kit files — token auth protection", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-TOKEN`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("attachment link href includes token, raw URL without token returns 403 @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    await expect(page.getByText("Attachments", { exact: true }).first()).toBeVisible();

    // Upload a temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `test-token-${TS}.txt`);
    fs.writeFileSync(tmpFile, "token auth protection test");

    const fileInput = page.locator('[data-testid="attachment-file-input"]');
    await fileInput.setInputFiles(tmpFile);

    await expect(page.getByText("File uploaded", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Verify the rendered link includes ?token= (protected file URL)
    const linkLocator = page.locator('[data-testid^="attachment-link-"]').first();
    await expect(linkLocator).toBeVisible();
    const href = await linkLocator.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toContain("token=");

    // Strip the token — PocketBase should reject the raw URL with 403
    const rawUrl = href!.replace(/[?&]token=[^&]+/, "").replace(/[?&]$/, "").replace(/\?$/, "");
    const response = await page.request.get(rawUrl);
    expect(response.status()).toBe(403);

    fs.unlinkSync(tmpFile);
  });
});

// ---------------------------------------------------------------------------
// Test 4: viewer sees list but NO upload/delete buttons
// ---------------------------------------------------------------------------

test.describe("Kit files — viewer access", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-VIEW`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    if (kitId) await deleteKit(kitId);
  });

  test("viewer sees attachments section but no upload or delete buttons @smoke", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto(`/kits/${kitId}`);

    // Attachments card should be visible to viewer
    await expect(page.getByText("Attachments", { exact: true }).first()).toBeVisible();

    // No upload button
    await expect(page.getByRole("button", { name: /upload file/i })).not.toBeVisible();

    // No delete buttons
    await expect(page.locator('[data-testid^="attachment-delete-"]')).toHaveCount(0);
  });
});
