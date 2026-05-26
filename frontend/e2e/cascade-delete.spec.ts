/**
 * Cascade delete UI spec (T26).
 *
 * Covers spec §6.2 scenarios:
 *   1. Admin sees Danger Zone / Cascade Hard Delete button; viewer does not.
 *   2. Type-to-confirm gating: wrong serial → button disabled; correct serial → enabled.
 *   3. Full kit cascade: correct serial + click Delete → toast + redirect + audit row.
 *   4. Entity blocked by active transactions → preview shows blockers, Delete button hidden.
 *   5. Per-tx trash on kit timeline: dialog opens + single-tx delete works; viewer cannot see trash.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  deleteKit,
  createTestEntity,
  deactivateEntity,
  createTestTransaction,
  getAdminToken,
  getAdminUserId,
} from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const TS = `cascade-${Date.now()}`;

// ---------------------------------------------------------------------------
// Scenario 1 — Danger Zone visibility gating (smoke)
// ---------------------------------------------------------------------------

test.describe("Cascade delete — Danger Zone button gating @smoke", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-KIT`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("admin sees Cascade Hard Delete button on kit detail @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: "Cascade Hard Delete" })).toBeVisible();
  });

  test("viewer does NOT see Cascade Hard Delete button on kit detail @smoke", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: "Cascade Hard Delete" })).not.toBeVisible();
  });

  test("clicking Cascade Hard Delete opens dialog with 'Hard delete' title @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await page.getByRole("button", { name: "Cascade Hard Delete" }).click();
    // Dialog title: "Hard delete kit '<serial>' with cascade?" or loading state
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/[Hh]ard delete/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Type-to-confirm gating
// ---------------------------------------------------------------------------

test.describe("Cascade delete — type-to-confirm gating", () => {
  const SERIAL = `${TS}-CONFIRM`;
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(SERIAL);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId).catch(() => {});
  });

  test("wrong serial leaves Delete button disabled; correct serial enables it", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    await page.getByRole("button", { name: "Cascade Hard Delete" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Wait for preview to load (the confirm input appears when preview is ready and not blocked)
    const confirmInput = page.getByLabel(/Type the serial/i);
    await expect(confirmInput).toBeVisible({ timeout: 10_000 });

    // Type wrong serial — Delete button should be disabled
    await confirmInput.fill("WRONG-SERIAL");
    const deleteBtn = page.getByRole("button", { name: /Hard delete with cascade/i });
    await expect(deleteBtn).toBeDisabled();

    // Clear and type correct serial — Delete button should be enabled
    await confirmInput.clear();
    await confirmInput.fill(SERIAL);
    await expect(deleteBtn).not.toBeDisabled();

    // Close without deleting
    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Full kit cascade: toast + redirect + audit row
// ---------------------------------------------------------------------------

test.describe("Cascade delete — full kit delete with audit verification", () => {
  const SERIAL = `${TS}-DEL`;
  let kitId: string;
  let entityId: string;

  test.beforeAll(async () => {
    const entity = await createTestEntity(`${TS}-ENT-DEL`);
    entityId = entity.id;
    const kit = await createTestKit(SERIAL);
    kitId = kit.id;
    // Seed one transaction so kit has a non-trivial cascade
    await createTestTransaction({ kitId, toEntityId: entityId });
  });

  test.afterAll(async () => {
    // Kit is hard-deleted by the test; entity needs cleanup
    await deactivateEntity(entityId).catch(() => {});
  });

  test("admin types correct serial + clicks Delete → toast + redirect + audit row", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    await page.getByRole("button", { name: "Cascade Hard Delete" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Wait for confirm input
    const confirmInput = page.getByLabel(/Type the serial/i);
    await expect(confirmInput).toBeVisible({ timeout: 10_000 });
    await confirmInput.fill(SERIAL);

    const deleteBtn = page.getByRole("button", { name: /Hard delete with cascade/i });
    await expect(deleteBtn).not.toBeDisabled();
    await deleteBtn.click();

    // Toast "Deleted" or "Kit deleted with cascade" should appear
    await expect(page.getByText(/Deleted/i).first()).toBeVisible({ timeout: 10_000 });

    // Redirect to /kits
    await page.waitForURL("**/kits", { timeout: 10_000 });

    // Kit no longer in list
    await page.getByPlaceholder(/search by serial/i).fill(SERIAL);
    await expect(page.getByText(/no kits found/i)).toBeVisible({ timeout: 5_000 });

    // Verify audit_log row via API
    const token = await getAdminToken();
    const adminId = await getAdminUserId();
    const encoded = encodeURIComponent(
      `collection_name="kits" && record_id="${kitId}" && action="cascade_delete"`
    );
    let auditRow: Record<string, unknown> | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(
        `${PB_URL}/api/collections/audit_log/records?filter=${encoded}&sort=-created&perPage=1`,
        { headers: { Authorization: token } }
      );
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        auditRow = data.items[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(auditRow).not.toBeNull();
    expect(auditRow!.action).toBe("cascade_delete");
    expect(auditRow!.record_id).toBe(kitId);
    expect(auditRow!.actor).toBe(adminId);
    const changes = JSON.parse(auditRow!.changes as string);
    expect(changes.before).toBeTruthy();
    expect(changes.before.serial ?? changes.before.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Entity blocked by active transactions
// ---------------------------------------------------------------------------

test.describe("Cascade delete — entity blocked by active transactions", () => {
  let entityId: string;
  let kitId: string;

  test.beforeAll(async () => {
    // entity under test
    const entity = await createTestEntity(`${TS}-ENT-BLOCK`);
    entityId = entity.id;
    const kit = await createTestKit(`${TS}-KIT-BLOCK`);
    kitId = kit.id;
    // Transaction targets the entity under test
    await createTestTransaction({ kitId, toEntityId: entityId });
  });

  test.afterAll(async () => {
    await deactivateEntity(entityId).catch(() => {});
    await deleteKit(kitId).catch(() => {});
  });

  test("entity with active transactions shows blockers; Delete button hidden", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/entities/${entityId}`);

    await page.getByRole("button", { name: "Cascade Hard Delete" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Preview loads and shows blocker section
    await expect(page.getByRole("dialog").getByText(/Cannot delete — referenced by/i)).toBeVisible({ timeout: 10_000 });

    // "transactions" appears in blockers table
    await expect(page.getByRole("dialog").getByText("transactions")).toBeVisible();

    // Delete button should NOT be visible (only Close is shown for blocked)
    await expect(page.getByRole("button", { name: /Hard delete with cascade/i })).not.toBeVisible();

    // Close button is visible — use first() since dialog also has an X (close) button
    const closeBtn = page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Per-transaction trash on kit timeline
// ---------------------------------------------------------------------------

test.describe("Cascade delete — per-tx trash on kit timeline", () => {
  let kitId: string;
  let entityId: string;
  let txId: string;

  test.beforeAll(async () => {
    const entity = await createTestEntity(`${TS}-ENT-TX`);
    entityId = entity.id;
    const kit = await createTestKit(`${TS}-KIT-TX`);
    kitId = kit.id;
    const tx = await createTestTransaction({ kitId, toEntityId: entityId });
    txId = tx.id;
  });

  test.afterAll(async () => {
    // tx may have been hard-deleted by test; kit and entity need cleanup
    await deleteKit(kitId).catch(() => {});
    await deactivateEntity(entityId).catch(() => {});
  });

  test("viewer cannot see trash icon on transaction rows", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto(`/kits/${kitId}`);

    // Wait for timeline to load
    const timelineCard = page.locator('[class*="card"]').filter({ hasText: /Location history/i });
    await expect(timelineCard).toBeVisible({ timeout: 8_000 });

    // Wait for transaction rows to appear (timeline loaded)
    await page.waitForTimeout(1_000);

    // Viewer should not see trash buttons (admin-only).
    // KitTimeline renders Button with h-7 w-7 p-0 classes for the trash icon button.
    await expect(timelineCard.locator('button[class*="h-7"][class*="w-7"]')).toHaveCount(0);
  });

  test("admin sees trash icon → dialog opens → type tx id → Delete → tx removed from timeline", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Wait for timeline to load with the transaction
    const timelineCard = page.locator('[class*="card"]').filter({ hasText: /Location history/i });
    await expect(timelineCard).toBeVisible({ timeout: 8_000 });

    // Find the trash (cascade-delete) button in the timeline (admin-only).
    // The latest tx row now also renders a "Revert" button with the same
    // h-7 w-7 p-0 sizing, so match the trash button by its distinguishing
    // hover:text-destructive class to avoid grabbing Revert instead.
    const trashBtn = timelineCard
      .locator('button[class*="h-7"][class*="w-7"][class*="hover:text-destructive"]')
      .first();
    await expect(trashBtn).toBeVisible({ timeout: 8_000 });
    await trashBtn.click();

    // CascadeDeleteDialog opens for collection="transactions"
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/[Hh]ard delete/);

    // For transactions, identifier_field = "id" → confirm input placeholder is the tx id
    const confirmInput = page.getByLabel(/Type the id/i);
    await expect(confirmInput).toBeVisible({ timeout: 10_000 });
    await confirmInput.fill(txId);

    const deleteBtn = page.getByRole("button", { name: /Hard delete with cascade/i });
    await expect(deleteBtn).not.toBeDisabled();
    await deleteBtn.click();

    // Toast appears
    await expect(page.getByText(/Deleted/i).first()).toBeVisible({ timeout: 10_000 });

    // Dialog closes
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5_000 });

    // Transaction row is removed from timeline — timeline shows no records
    await expect(timelineCard.getByText(/No location history yet/i)).toBeVisible({ timeout: 8_000 });
  });
});
