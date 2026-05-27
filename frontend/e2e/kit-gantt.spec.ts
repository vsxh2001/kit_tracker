/**
 * Kit Gantt / Timeline feature tests.
 *
 * Coverage:
 *   1. Timeline renders for kit with 3 transactions (3 segments, correct labels)
 *   2. Timeline empty state for kit with no transactions
 *   3. Closest-delivery column shows upcoming approved request
 *   4. Kit with no upcoming approved request shows —
 *   5. Only the soonest upcoming delivery is shown when multiple exist
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  createTestEntity,
  createTestRequest,
  deleteKit,
  deactivateEntity,
  getAdminUserId,
} from "./helpers/api";

const TS = `gantt-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1: Timeline with 3 transactions
// ---------------------------------------------------------------------------

test.describe("Timeline renders for kit with 3 transactions", () => {
  let kitId: string;
  let entity1Id: string;
  let entity2Id: string;
  let entity3Id: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-TL3`);
    kitId = kit.id;
    const e1 = await createTestEntity(`${TS}-E1`);
    entity1Id = e1.id;
    const e2 = await createTestEntity(`${TS}-E2`);
    entity2Id = e2.id;
    const e3 = await createTestEntity(`${TS}-E3`);
    entity3Id = e3.id;

    // Create 3 transactions with increasing timestamps (entity1 → entity2 → entity3)
    const now = Date.now();
    await createTestTransactionWithTimestamp(kitId, entity1Id, new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString());
    await createTestTransactionWithTimestamp(kitId, entity2Id, new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), entity1Id);
    await createTestTransactionWithTimestamp(kitId, entity3Id, new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), entity2Id);
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entity1Id);
    await deactivateEntity(entity2Id);
    await deactivateEntity(entity3Id);
  });

  test("3 timeline segments visible with correct entity labels", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Wait for timeline card to appear
    await expect(page.getByText("Location history")).toBeVisible({ timeout: 10_000 });

    const segments = page.locator('[data-testid="timeline-segment"]');
    await expect(segments).toHaveCount(3, { timeout: 10_000 });

    // Check entity names appear in segments
    await expect(page.locator('[data-entity="' + `${TS}-E1` + '"]').first()).toBeVisible();
    await expect(page.locator('[data-entity="' + `${TS}-E2` + '"]').first()).toBeVisible();
    await expect(page.locator('[data-entity="' + `${TS}-E3` + '"]').first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Timeline empty state
// ---------------------------------------------------------------------------

test.describe("Timeline empty state for kit with no transactions", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-TL0`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("shows 'No location history yet' text", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByText("No location history yet")).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 3: Next delivery column shows upcoming approved request
// ---------------------------------------------------------------------------

test.describe("Next delivery column shows upcoming approved", () => {
  let kitId: string;
  let entityId: string;
  let requestId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-DEL1`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-DelEnt1`);
    entityId = entity.id;
    const adminId = await getAdminUserId();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const req = await createTestRequest({
      requesterId: adminId,
      designatedKitId: kitId,
      targetEntityId: entityId,
      status: "approved",
      deliveryDate: tomorrow,
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entityId);
    // Request is soft-state only — no delete needed
    void requestId;
  });

  test("Next delivery cell shows tomorrow's date and entity name", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    // Search for the kit to isolate the row
    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-DEL1`);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toLocaleDateString("en-CA"); // YYYY-MM-DD format matching app's formatDateOnly

    // Desktop table cell (the <span> inside the td) should be visible
    await expect(page.locator("table").getByText(new RegExp(tomorrowStr, "i"))).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("table").getByText(`${TS}-DelEnt1`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Kit with no upcoming shows —
// ---------------------------------------------------------------------------

test.describe("Kit with no upcoming approved shows dash", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-NODEL`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("Next delivery cell shows —", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-NODEL`);

    // The row should be visible
    await expect(page.getByRole("cell", { name: `${TS}-NODEL`, exact: true })).toBeVisible({ timeout: 10_000 });

    // Find the row and check the Next delivery cell shows —
    const row = page.getByRole("row").filter({ hasText: `${TS}-NODEL` });
    await expect(row.getByText("—").last()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 5: Only soonest upcoming is shown when multiple approved requests exist
// ---------------------------------------------------------------------------

test.describe("Only soonest upcoming delivery is shown", () => {
  let kitId: string;
  let entityId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-SOON`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-SoonEnt`);
    entityId = entity.id;
    const adminId = await getAdminUserId();

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Create two approved requests: tomorrow (soonest) and next week
    await createTestRequest({
      requesterId: adminId,
      designatedKitId: kitId,
      targetEntityId: entityId,
      status: "approved",
      deliveryDate: tomorrow,
    });
    await createTestRequest({
      requesterId: adminId,
      designatedKitId: kitId,
      targetEntityId: entityId,
      status: "approved",
      deliveryDate: nextWeek,
    });
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("shows tomorrow's date, not next week's", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-SOON`);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toLocaleDateString("en-CA"); // YYYY-MM-DD format matching app's formatDateOnly
    const nextWeekStr = nextWeek.toLocaleDateString("en-CA"); // YYYY-MM-DD format

    // Desktop table: tomorrow's date visible (soonest)
    await expect(page.locator("table").getByText(new RegExp(tomorrowStr, "i"))).toBeVisible({ timeout: 10_000 });
    // Next week's date should NOT appear in the table
    await expect(page.locator("table").getByText(new RegExp(nextWeekStr, "i"))).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

async function getToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
  });
  const data = await res.json();
  return data.token;
}

async function createTestTransactionWithTimestamp(
  kitId: string,
  toEntityId: string,
  timestamp: string,
  fromEntityId?: string,
): Promise<void> {
  const token = await getToken();
  const adminRes = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
  });
  const adminData = await adminRes.json();
  const userId = adminData.record.id;

  await fetch(`${PB_URL}/api/collections/transactions/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: kitId,
      from_entity: fromEntityId ?? null,
      to_entity: toEntityId,
      timestamp,
      created_by: userId,
    }),
  });
}
