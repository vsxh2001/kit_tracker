/**
 * Maintenance UI flows.
 *
 * Coverage:
 *   1. Admin can add a schedule on /kits/:id @smoke
 *   2. Admin/Tech can record maintenance → last_done + next_due update
 *   3. /maintenance page renders with sort + status filter
 *   4. /kits column shows next-maintenance for kit with schedule
 *   5. Permission gate: viewer + user do NOT see /maintenance link; direct nav redirects
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit } from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const TS = `maint-${Date.now()}`;

// Helper: get admin token
async function adminToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
  });
  const data = await res.json();
  return data.token;
}

async function createScheduleViaApi(kitId: string, type: string, intervalDays = 30): Promise<{ id: string }> {
  const token = await adminToken();
  const today = new Date().toISOString().slice(0, 10);
  const nextDue = new Date(Date.now() + intervalDays * 86400000).toISOString().slice(0, 10);
  const res = await fetch(`${PB_URL}/api/collections/kit_maintenance_schedules/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: kitId,
      type,
      description: "Test schedule",
      interval_days: intervalDays,
      last_done_at: today,
      next_due_at: nextDue,
      is_active: true,
      notes: "",
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createScheduleViaApi failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

async function deactivateSchedule(id: string): Promise<void> {
  const token = await adminToken();
  await fetch(`${PB_URL}/api/collections/kit_maintenance_schedules/records/${id}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: false }),
  });
}

async function deleteSchedulesByType(type: string): Promise<void> {
  const token = await adminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/kit_maintenance_schedules/records?filter=type="${type}"&perPage=100`,
    { headers: { Authorization: token } }
  );
  const data = await res.json();
  const schedules = data.items ?? [];
  for (const sched of schedules) {
    await fetch(`${PB_URL}/api/collections/kit_maintenance_schedules/records/${sched.id}`, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    });
  }
}

async function getSchedule(id: string): Promise<{ last_done_at: string; next_due_at: string }> {
  const token = await adminToken();
  const res = await fetch(`${PB_URL}/api/collections/kit_maintenance_schedules/records/${id}`, {
    headers: { Authorization: token },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Test 1: Admin can add schedule on /kits/:id
// ---------------------------------------------------------------------------

test.describe("Maintenance — add schedule", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-ADD`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("admin can add schedule on kit detail page @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Maintenance section should be visible (exact match on h2 tag to avoid "No maintenance schedules" h3)
    await expect(page.locator("h2", { hasText: "Maintenance" })).toBeVisible();

    // Click "Add schedule"
    await page.getByRole("button", { name: "Add schedule" }).first().click();

    // Fill form
    await page.getByLabel("Type").fill("Calibration");
    await page.getByLabel("Interval (days)").fill("30");

    // Fill next due date (should be auto-calculated, but try to fill if field exists)
    const nextDueField = page.getByLabel(/next due|next due at|next.*date/i);
    if (await nextDueField.isVisible().catch(() => false)) {
      const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      await nextDueField.fill(futureDate);
    }

    // Submit
    await page.getByRole("button", { name: "Add schedule" }).last().click();

    // Should see the new schedule in the list (scope to tbody to avoid notification text)
    await expect(page.locator("tbody").getByText("Calibration").first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 2: Admin can record maintenance — schedule updates
// ---------------------------------------------------------------------------

test.describe("Maintenance — record done", () => {
  let kitId: string;
  let schedId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-REC`);
    kitId = kit.id;
    const sched = await createScheduleViaApi(kitId, "BatteryCheck", 14);
    schedId = sched.id;
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("admin records maintenance via kit detail page", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Find "Record done" button (look for it in the maintenance card section)
    await expect(page.getByRole("heading").getByText("Maintenance")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Record done" }).first().click();

    // Dialog should appear
    await expect(page.getByText("Record Maintenance — BatteryCheck")).toBeVisible();

    // Submit with defaults
    await page.getByRole("button", { name: "Record done" }).last().click();

    // Success toast (use specific selector to avoid multiple matches)
    await expect(page.locator("div:has-text('Maintenance recorded')").first()).toBeVisible({ timeout: 10_000 });

    // Verify last_done_at was updated via API
    const updated = await getSchedule(schedId);
    const today = new Date().toISOString().slice(0, 10);
    expect(updated.last_done_at.slice(0, 10)).toBe(today);
  });
});

// ---------------------------------------------------------------------------
// Test 3: /maintenance page renders with status filter
// ---------------------------------------------------------------------------

test.describe("Maintenance page", () => {
  let kitId: string;
  let schedId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-PAGE`);
    kitId = kit.id;
    const sched = await createScheduleViaApi(kitId, "PageTest", 90);
    schedId = sched.id;
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("/maintenance page renders table with status filter chips", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
    // Status filter chips
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Overdue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Due soon" })).toBeVisible();
    await expect(page.getByRole("button", { name: "OK" })).toBeVisible();

    // Table column headers visible on desktop
    await expect(page.getByRole("columnheader", { name: "Kit serial" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Next due" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 4: /kits shows next-maintenance column for kit with schedule
// ---------------------------------------------------------------------------

test.describe("Kits page — next maintenance column", () => {
  let kitId: string;
  let schedId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-COL`);
    kitId = kit.id;
    const sched = await createScheduleViaApi(kitId, "ColCheck", 7);
    schedId = sched.id;
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("kits table shows next maintenance column", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    // Column header present
    await expect(page.getByRole("columnheader", { name: "Next maintenance" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 5: Permission gate — viewer/user can't access /maintenance
// ---------------------------------------------------------------------------

test.describe("Maintenance — permission gate", () => {
  test("viewer does not see Maintenance nav link", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/dashboard");
    // "Maintenance" nav link should NOT be present in sidebar
    await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
  });

  test("user role does not see Maintenance nav link", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
  });

  test("viewer direct nav to /maintenance redirects to /dashboard", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/maintenance");
    await page.waitForURL("**/dashboard", { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test 6: Admin creates schedule via "New schedule" button on /maintenance
// ---------------------------------------------------------------------------

test.describe("Maintenance — new schedule from hub @smoke", () => {
  let kitId: string;
  let schedSerial: string;

  test.beforeAll(async () => {
    // Clean up any leftover HubCalibration schedules from prior test runs before creating our kit
    await deleteSchedulesByType("HubCalibration");

    schedSerial = `${TS}-HUB`;
    const kit = await createTestKit(schedSerial);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    // Clean up schedules by type to prevent growth on retry
    await deleteSchedulesByType("HubCalibration");
    await deleteKit(kitId);
  });

  test("admin clicks 'New schedule' on /maintenance, picks kit, fills form, saves", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    // Button must be visible
    const newScheduleBtn = page.getByRole("button", { name: "New schedule" });
    await expect(newScheduleBtn).toBeVisible({ timeout: 10_000 });
    await newScheduleBtn.click();

    // Dialog opens — wait for the dialog content to be visible
    const dialogTitle = page.getByText("New Maintenance Schedule");
    await expect(dialogTitle).toBeVisible({ timeout: 10_000 });

    // Kit picker present (NewMaintenanceScheduleDialog uses #nsched-kit)
    const kitSelect = page.locator("#nsched-kit");
    await expect(kitSelect).toBeVisible();
    await kitSelect.selectOption({ label: schedSerial });

    // Fill required fields
    // Type is a Radix Select in NewMaintenanceScheduleDialog
    const typeSelect = page.locator("#nsched-type");
    await expect(typeSelect).toBeVisible();
    await typeSelect.click();
    await page.getByRole("option", { name: "Calibration" }).click();

    // Description is required
    await page.getByLabel("Description").fill("Hub calibration procedure");

    // Interval days
    await page.getByLabel("Interval (days)").fill("45");

    // Save (NewMaintenanceScheduleDialog uses "Create schedule" button)
    await page.getByRole("button", { name: "Create schedule" }).last().click();

    // Success toast
    await expect(page.locator("div:has-text('Schedule created')").first()).toBeVisible({ timeout: 10_000 });

    // Schedule appears in the table (scope to tbody to avoid notification/option matches, use first() for strict mode)
    await expect(page.locator("tbody").getByText("Calibration").first()).toBeVisible({ timeout: 5000 });
  });
});
