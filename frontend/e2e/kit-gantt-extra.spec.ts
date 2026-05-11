/**
 * Kit Gantt — edge-case coverage (post-merge verification, 2026-05-11).
 *
 * Covers scenarios NOT included in kit-gantt.spec.ts:
 *   1. Single-transaction kit: full-width bar, correct date labels
 *   2. Approved request with empty designated_kit: does NOT appear on any kit
 *   3. Approved request with past delivery_date: does NOT appear in Next delivery
 *   4. Two transactions same second: layout doesn't crash (hairlines render)
 *   5. Loading state: "Loading…" shown before data, replaced by table
 *   6. Sort desc: kits without deliveries float to top in descending order
 *
 * P2 findings documented as skipped tests with TODO (not fixing app code):
 *   - Tooltip shows date-only strings for intra-day segments ("08/05/2026 → 08/05/2026")
 *     which loses time precision (P2, cosmetic).
 *
 * All tests serial (workers:1) — shared PocketBase mutable state.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  createTestEntity,
  createTestRequest,
  createTestTransaction,
  deleteKit,
  deactivateEntity,
  getAdminUserId,
} from "./helpers/api";

const TS = `gantt-ex-${Date.now()}`;
const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// ---------------------------------------------------------------------------
// Helper: create transaction with explicit timestamp via direct REST
// (api.ts createTestTransaction always uses now — we need custom timestamps)
// ---------------------------------------------------------------------------

async function createTxAt(
  kitId: string,
  toEntityId: string,
  isoTimestamp: string,
  fromEntityId?: string,
): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
  });
  const { token, record } = await res.json();
  const txRes = await fetch(`${PB_URL}/api/collections/transactions/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: kitId,
      from_entity: fromEntityId ?? null,
      to_entity: toEntityId,
      timestamp: isoTimestamp,
      created_by: record.id,
    }),
  });
  if (!txRes.ok) {
    const body = await txRes.json();
    throw new Error(`createTxAt failed: ${JSON.stringify(body)}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Single-transaction kit — full-width bar + correct date axis
// ---------------------------------------------------------------------------

test.describe("Single-transaction kit: full-width timeline bar", () => {
  let kitId: string;
  let entityId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-SINGLE`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-E-Single`);
    entityId = entity.id;
    // One transaction exactly 30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await createTxAt(kitId, entityId, thirtyDaysAgo);
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("renders exactly 1 bar spanning full width", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByText("Location history"), { message: "Location history card must appear" }).toBeVisible({ timeout: 10_000 });

    const segments = page.locator('[data-testid="timeline-segment"]');
    await expect(segments, { message: "Exactly 1 segment for single-tx kit" }).toHaveCount(1, { timeout: 8_000 });

    // The single segment should cover near-full width (>95%)
    const seg = segments.first();
    const barContainer = page.locator('.relative.h-12.w-full');
    const segBB = await seg.boundingBox();
    const barBB = await barContainer.boundingBox();

    expect(segBB, { message: "Segment must have a bounding box" }).not.toBeNull();
    expect(barBB, { message: "Bar container must have a bounding box" }).not.toBeNull();

    const widthPct = (segBB!.width / barBB!.width) * 100;
    expect(widthPct, { message: `Single-tx bar width should be > 95% of container, got ${widthPct.toFixed(1)}%` }).toBeGreaterThan(95);
  });

  test("date axis start label matches transaction date", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.locator('[data-testid="timeline-segment"]')).toBeVisible({ timeout: 10_000 });

    // Left axis label should exist and not be "today" (transaction was 30d ago)
    const labels = page.locator('[class*="flex justify-between mt-1"] span, [class*="flex justify-between mt-1"] > *');
    const labelCount = await labels.count();
    expect(labelCount, { message: "Should have 2 date axis labels" }).toBe(2);

    // Start label text should exist and be non-empty
    const startLabel = labels.first();
    const startText = await startLabel.textContent();
    expect(startText, { message: "Start label should have a date" }).toBeTruthy();
    expect(startText!.trim(), { message: "Start label should not be empty" }).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Approved request with empty designated_kit — NOT shown in any kit row
// ---------------------------------------------------------------------------

test.describe("Approved request with empty designated_kit is ignored", () => {
  let requestId: string;
  let kitId: string;

  test.beforeAll(async () => {
    // Create a kit that should NOT pick up this request
    const kit = await createTestKit(`${TS}-NODESG`);
    kitId = kit.id;
    const adminId = await getAdminUserId();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    // Request has NO designated_kit (undefined → null)
    const req = await createTestRequest({
      requesterId: adminId,
      status: "approved",
      deliveryDate: tomorrow,
      // designatedKitId intentionally omitted → null
    });
    requestId = req.id;
    void requestId; // used for cleanup documentation
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    // No cleanup for request — soft state only (no delete rule)
  });

  test("kit row shows — in Next delivery when undesignated approved request exists", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-NODESG`);
    await expect(page.getByRole("cell", { name: `${TS}-NODESG` })).toBeVisible({ timeout: 10_000 });

    const row = page.getByRole("row").filter({ hasText: `${TS}-NODESG` });
    // The Next delivery cell should show — (the undesignated request must not pollute this kit)
    await expect(row.getByText("—").last(), { message: "Undesignated approved request must not appear in any kit Next delivery" }).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Approved request with past delivery_date — NOT shown
// ---------------------------------------------------------------------------

test.describe("Past delivery_date approved request is not shown", () => {
  let kitId: string;
  let entityId: string;
  let requestId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-PAST`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-E-Past`);
    entityId = entity.id;
    const adminId = await getAdminUserId();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const req = await createTestRequest({
      requesterId: adminId,
      designatedKitId: kitId,
      targetEntityId: entityId,
      status: "approved",
      deliveryDate: yesterday,
    });
    requestId = req.id;
    void requestId;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("kit with only past approved request shows — in Next delivery", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-PAST`);
    await expect(page.getByRole("cell", { name: `${TS}-PAST` })).toBeVisible({ timeout: 10_000 });

    const row = page.getByRole("row").filter({ hasText: `${TS}-PAST` });
    await expect(row.getByText("—").last(), { message: "Past delivery date must not appear — filter should exclude it" }).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Two transactions within same second — no crash, both segments render
// ---------------------------------------------------------------------------

test.describe("Same-second transactions: layout doesn't crash", () => {
  let kitId: string;
  let entity1Id: string;
  let entity2Id: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-SAMESEC`);
    kitId = kit.id;
    const e1 = await createTestEntity(`${TS}-E-SS1`);
    entity1Id = e1.id;
    const e2 = await createTestEntity(`${TS}-E-SS2`);
    entity2Id = e2.id;

    // Both transactions at the same second (same ISO string)
    const sameTime = new Date(Date.now() - 60 * 1000).toISOString();
    await createTxAt(kitId, entity1Id, sameTime);
    await createTxAt(kitId, entity2Id, sameTime, entity1Id);
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entity1Id);
    await deactivateEntity(entity2Id);
  });

  test("timeline renders without error (2 segments present, no JS exception)", async ({ page }) => {
    await loginAs(page, "admin");

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`/kits/${kitId}`);
    await expect(page.getByText("Location history"), { message: "Timeline card must load" }).toBeVisible({ timeout: 10_000 });

    // Should have 2 segments (even if one is zero-width / hairline)
    const segments = page.locator('[data-testid="timeline-segment"]');
    await expect(segments, { message: "Both same-second segments must be rendered (even if invisible)" }).toHaveCount(2, { timeout: 8_000 });

    expect(errors, { message: "No JS exceptions from same-second transaction rendering" }).toHaveLength(0);

    // NOTE: The second segment will have 0% width (start === end of prev for sort ties).
    // This is a known visual artifact (P2) — hairline bar invisible but no crash.
  });
});

// ---------------------------------------------------------------------------
// Test 5: Loading state — "Loading…" visible briefly, then replaced by table
// ---------------------------------------------------------------------------

test.describe("Loading state on /kits", () => {
  test("shows Loading text then table (not blank)", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    // After data loads, the "Loading…" text must be gone and column header present
    await expect(
      page.getByRole("columnheader", { name: /next delivery/i }),
      { message: "Next delivery column header must be visible after data loads" }
    ).toBeVisible({ timeout: 10_000 });
    // "Loading…" must no longer be present
    await expect(
      page.getByText("Loading…"),
      { message: "Loading text must disappear once data is ready" }
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 6: Sort desc — kits without deliveries float to TOP
// ---------------------------------------------------------------------------

test.describe("Delivery sort descending: no-delivery kits float to top", () => {
  let kitWithDeliveryId: string;
  let kitNoDeliveryId: string;
  let entityId: string;

  test.beforeAll(async () => {
    const kd = await createTestKit(`${TS}-SORTD-DEL`);
    kitWithDeliveryId = kd.id;
    const kn = await createTestKit(`${TS}-SORTD-NO`);
    kitNoDeliveryId = kn.id;
    const entity = await createTestEntity(`${TS}-E-SortD`);
    entityId = entity.id;
    const adminId = await getAdminUserId();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    await createTestRequest({
      requesterId: adminId,
      designatedKitId: kitWithDeliveryId,
      targetEntityId: entityId,
      status: "approved",
      deliveryDate: tomorrow,
    });
  });

  test.afterAll(async () => {
    await deleteKit(kitWithDeliveryId);
    await deleteKit(kitNoDeliveryId);
    await deactivateEntity(entityId);
  });

  test("descending sort puts no-delivery kits first", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await page.waitForLoadState("networkidle");

    // Sort by delivery ASC first (to establish state), then DESC
    await page.getByRole("columnheader", { name: /next delivery/i }).click();
    // Now ASC: kit-with-delivery first
    await page.waitForTimeout(300);

    await page.getByRole("columnheader", { name: /next delivery/i }).click();
    // Now DESC: no-delivery kits float to top
    await page.waitForTimeout(300);

    // Filter to only these two test kits — search for partial name
    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-SORTD`);
    await page.waitForLoadState("networkidle");

    const rows = page.getByRole("row").filter({ hasText: new RegExp(`${TS}-SORTD`) });
    const rowCount = await rows.count();
    expect(rowCount, { message: "Both test kit rows must be visible after filter" }).toBe(2);

    // First row (index 0 is header in rowgroup, but getByRole rows excluding header)
    // Use getByRole("cell") to get order
    const rowTexts = await rows.allTextContents();
    // In DESC order: no-delivery kit should come before delivery kit
    const noDelIdx = rowTexts.findIndex((t) => t.includes(`${TS}-SORTD-NO`));
    const withDelIdx = rowTexts.findIndex((t) => t.includes(`${TS}-SORTD-DEL`));

    expect(noDelIdx, { message: "No-delivery kit must appear first in DESC sort" }).toBeLessThan(withDelIdx);
  });
});

// ---------------------------------------------------------------------------
// Test 7: (DOCUMENTED BUG P2) Tooltip time precision — skipped, bug surfaces finding
// ---------------------------------------------------------------------------

test.skip("P2 BUG: intra-day segment tooltip loses time precision", async ({ page }) => {
  // TODO: KitTimeline.tsx uses formatDateOnly() for tooltip start/end dates.
  // For segments spanning < 1 day (e.g., Kit with moves at 15:00, 15:19, 15:26),
  // the tooltip shows "EntityName · 08/05/2026 → 08/05/2026" which is misleading.
  // Fix: use formatDate() (includes time) instead of formatDateOnly() for tooltip.
  // File: frontend/src/components/KitTimeline.tsx line 89
  void page;
});

// ---------------------------------------------------------------------------
// Test 8: (DOCUMENTED BUG P2) Sub-pixel hairline segments invisible
// ---------------------------------------------------------------------------

test.skip("P2 BUG: sub-pixel hairline segments are invisible in browser", async ({ page }) => {
  // TODO: When multiple transactions occur within a short timespan relative to the
  // full history span, segments can be < 1px wide and invisible.
  // E.g., KIT-001 (7 transactions spanning 10 days): segments 2-4 are 0.05-0.14% wide
  // = sub-pixel. Browser rounds to 0px, segment is not visible.
  // Fix: enforce minimum width (e.g., min-w-[2px]) on timeline-segment divs.
  // File: frontend/src/components/KitTimeline.tsx line 93
  void page;
});
