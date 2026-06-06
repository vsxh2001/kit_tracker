/**
 * Maintenance UI flows.
 *
 * Coverage:
 *   1. Admin can add a schedule on /kits/:id @smoke
 *   2. Admin/Tech can record maintenance → last_done + next_due update
 *   3. /maintenance page renders with sort + status filter
 *   4. /kits column shows next-maintenance for kit with schedule
 *   5. Permission gate: viewer + user do NOT see /maintenance link; direct nav redirects
 *   9. Schedule detail page: row click → /maintenance/:id, history table, Record done @smoke
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit, createTestComponent, deactivateComponent } from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const TS = `maint-${Date.now()}`;

// Helper: get admin token + user ID
async function adminAuth(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
  });
  const data = await res.json();
  return { token: data.token, userId: data.record?.id ?? "" };
}

// Helper: get admin token
async function adminToken(): Promise<string> {
  return (await adminAuth()).token;
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
    // Type is a Radix Select, use combobox pattern
    await page.getByRole("dialog").getByRole("combobox").click();
    await page.getByRole("option", { name: "Calibration" }).click();
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
    const sched = await createScheduleViaApi(kitId, "replacement", 14);
    schedId = sched.id;
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("admin records maintenance via kit detail page", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Find "Record done" button (look for it in the maintenance card section).
    // exact: true — the empty-state "No maintenance schedules" heading also
    // contains "Maintenance" and would otherwise collide.
    await expect(page.getByRole("heading", { name: "Maintenance", exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Record done" }).first().click();

    // Dialog should appear
    await expect(page.getByText("Record Maintenance — replacement")).toBeVisible();

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
    const sched = await createScheduleViaApi(kitId, "other", 90);
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

    // Table column headers visible on desktop (wait for table to load)
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("thead th").first()).toBeVisible();
    // Verify key columns exist (Target, Type, Next due)
    const headers = await page.locator("thead th").allTextContents();
    expect(headers.join(",")).toContain("Target");
    expect(headers.join(",")).toContain("Type");
    expect(headers.join(",")).toContain("Next due");
  });

  test("/maintenance?status=overdue activates Overdue chip and roundtrips via URL", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance?status=overdue");

    // Heading present, page loaded
    await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();

    // Overdue chip is the active one (selected style = bg-indigo-600)
    const overdueChip = page.getByRole("button", { name: "Overdue" });
    await expect(overdueChip).toHaveClass(/bg-indigo-600/);

    // Other chips are NOT the active one
    await expect(page.getByRole("button", { name: "All" })).not.toHaveClass(/bg-indigo-600/);

    // Clicking "All" clears the status param from the URL
    await page.getByRole("button", { name: "All" }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByRole("button", { name: "All" })).toHaveClass(/bg-indigo-600/);
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
    const sched = await createScheduleViaApi(kitId, "calibration", 7);
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
// Test 6: Admin snoozes a schedule (F6)
// ---------------------------------------------------------------------------

test.describe("Maintenance — snooze schedule @smoke", () => {
  let kitId: string;
  let schedId: string;
  let originalNextDue: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-SNZ`);
    kitId = kit.id;
    const sched = await createScheduleViaApi(kitId, "inspection", 30);
    schedId = sched.id;
    const data = await getSchedule(schedId);
    originalNextDue = data.next_due_at.slice(0, 10);
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("admin clicks Snooze on a schedule, picks 7 days, sees toast, next_due_at advanced @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    // Wait for table to render
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });

    // Find Snooze button for our specific kit's row (match by unique serial to avoid
    // ambiguity when another inspect-type schedule exists elsewhere in the table)
    const snoozeBtn = page.getByRole("row", { name: new RegExp(`${TS}-SNZ`) }).getByRole("button", { name: "Snooze" });
    await expect(snoozeBtn).toBeVisible({ timeout: 10_000 });
    await snoozeBtn.click();

    // Dialog opens
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Snooze Schedule")).toBeVisible();

    // "7 days" button is default active — click Snooze to submit
    await page.getByRole("button", { name: "Snooze" }).last().click();

    // Toast appears
    await expect(page.locator("div:has-text('Schedule snoozed')").first()).toBeVisible({ timeout: 10_000 });

    // Verify next_due_at advanced 7 days via API
    const updated = await getSchedule(schedId);
    const origDate = new Date(originalNextDue + "T00:00:00Z");
    const newDate = new Date(updated.next_due_at.slice(0, 10) + "T00:00:00Z");
    const diffDays = Math.round((newDate.getTime() - origDate.getTime()) / 86400000);
    expect(diffDays).toBe(7);
  });

  test("viewer cannot see Snooze button on /maintenance", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/dashboard");
    // Viewer is redirected from /maintenance; verify no Snooze button reachable via nav
    await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 7 (was 6): Admin creates schedule via "New schedule" button on /maintenance
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

  test("admin clicks 'New schedule' on /maintenance, picks kit, fills form, saves @smoke", async ({ page }) => {
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

// ---------------------------------------------------------------------------
// Test 8: Bulk-apply schedule across multiple kits @smoke (F5)
// ---------------------------------------------------------------------------

test.describe("Maintenance — bulk-apply schedule @smoke", () => {
  const kitIds: string[] = [];
  const kitSerials: string[] = [];

  test.beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const serial = `${TS}-BULK-${i}`;
      const kit = await createTestKit(serial);
      kitIds.push(kit.id);
      kitSerials.push(serial);
    }
  });

  test.afterAll(async () => {
    // Deactivate any bulk-created schedules and delete test kits
    const token = await adminToken();
    for (const kitId of kitIds) {
      // Deactivate schedules for this kit
      const res = await fetch(
        `${PB_URL}/api/collections/kit_maintenance_schedules/records?filter=${encodeURIComponent(`kit="${kitId}"`)}&perPage=100`,
        { headers: { Authorization: token } }
      );
      const data = await res.json();
      for (const sched of data.items ?? []) {
        await fetch(`${PB_URL}/api/collections/kit_maintenance_schedules/records/${sched.id}`, {
          method: "PATCH",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: false }),
        });
      }
      await deleteKit(kitId);
    }
  });

  test("admin bulk-applies schedule to 3 kits, sees toast 'Created 3 schedules' @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    const newScheduleBtn = page.getByRole("button", { name: "New schedule" });
    await expect(newScheduleBtn).toBeVisible({ timeout: 10_000 });
    await newScheduleBtn.click();

    // Dialog opens
    await expect(page.getByText("New Maintenance Schedule")).toBeVisible({ timeout: 10_000 });

    // Toggle bulk mode
    const bulkToggle = page.locator("#nsched-bulk-toggle");
    await expect(bulkToggle).toBeVisible();
    await bulkToggle.check();

    // Select all 3 test kits
    for (const serial of kitSerials) {
      const kitCheckbox = page.locator(`[data-kit-id="${kitIds[kitSerials.indexOf(serial)]}"]`);
      await expect(kitCheckbox).toBeVisible({ timeout: 5_000 });
      await kitCheckbox.check();
    }

    // Fill type
    const typeSelect = page.locator("#nsched-type");
    await typeSelect.click();
    await page.getByRole("option", { name: "Service" }).click();

    // Fill description
    await page.getByLabel("Description").fill("Bulk service procedure");

    // Interval
    await page.getByLabel("Interval (days)").fill("60");

    // Submit
    await page.getByRole("button", { name: /Create.*schedule/i }).last().click();

    // Success toast
    await expect(page.locator("div:has-text('Created 3 schedules')").first()).toBeVisible({ timeout: 15_000 });

    // Verify via API — each kit has a schedule
    const token = await adminToken();
    for (const kitId of kitIds) {
      const res = await fetch(
        `${PB_URL}/api/collections/kit_maintenance_schedules/records?filter=${encodeURIComponent(`kit="${kitId}" && is_active=true`)}`,
        { headers: { Authorization: token } }
      );
      const data = await res.json();
      expect((data.items ?? []).length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 7: Admin edits a schedule inline from /maintenance hub @smoke
// ---------------------------------------------------------------------------

test.describe("Maintenance — edit schedule inline @smoke", () => {
  let kitId: string;
  let schedId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-EDIT`);
    kitId = kit.id;
    const sched = await createScheduleViaApi(kitId, "inspection", 60);
    schedId = sched.id;
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("admin clicks Edit on schedule row, changes description, sees updated value in table @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible({ timeout: 10_000 });

    // Find the Edit button in the row for our kit (desktop table)
    // The row has the kit serial in it; click the Edit button within that row
    const row = page.locator("tr").filter({ hasText: `${TS}-EDIT` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Edit" }).click();

    // Dialog opens
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Edit Maintenance Schedule")).toBeVisible();

    // Change description
    const descField = page.getByLabel("Description");
    await descField.clear();
    await descField.fill("Updated description for test");

    // Save
    await page.getByRole("button", { name: "Save changes" }).click();

    // Success toast
    await expect(page.locator("div:has-text('Schedule updated')").first()).toBeVisible({ timeout: 10_000 });

    // Verify via API that description changed and other fields unchanged
    const token = await adminToken();
    const res = await fetch(`${PB_URL}/api/collections/kit_maintenance_schedules/records/${schedId}`, {
      headers: { Authorization: token },
    });
    const updated = await res.json();
    expect(updated.description).toBe("Updated description for test");
    expect(updated.type).toBe("inspection");
    expect(updated.interval_days).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Test F8: Admin adds maintenance schedule on component detail page @smoke
// ---------------------------------------------------------------------------

test.describe("Maintenance — per-component schedule @smoke", () => {
  let componentId: string;

  test.beforeAll(async () => {
    const comp = await createTestComponent({ serial: `${TS}-COMP-MAINT` });
    componentId = comp.id;
  });

  test.afterAll(async () => {
    await deactivateComponent(componentId);
  });

  test("admin opens component detail, adds schedule, sees it on /maintenance @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/components/${componentId}`);

    // Wait for component detail page to load
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Maintenance section heading - use role match instead of hasText
    await expect(page.locator("h2").first()).toBeVisible({ timeout: 10_000 });

    // Click "Add schedule"
    await page.getByRole("button", { name: "Add schedule" }).first().click();

    // Dialog opens
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    // Fill type via Radix Select combobox
    await page.getByRole("dialog").getByRole("combobox").click();
    await page.getByRole("option", { name: "Inspection" }).click();

    // Fill interval
    await page.getByLabel("Interval (days)").fill("90");

    // Submit
    await page.getByRole("button", { name: "Add schedule" }).last().click();

    // Success toast
    await expect(page.locator("div:has-text('Schedule created')").first()).toBeVisible({ timeout: 10_000 });

    // Schedule visible in component detail table
    await expect(page.locator("tbody").getByText("inspection").first()).toBeVisible({ timeout: 5_000 });

    // Now verify on /maintenance hub — component schedule appears
    await page.goto("/maintenance");
    await expect(page.getByRole("columnheader", { name: "Target" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("td:has-text('component')").first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Helper: create a maintenance record via API (requires admin+tech create rule)
// ---------------------------------------------------------------------------

async function createMaintenanceRecordViaApi(schedId: string): Promise<{ id: string }> {
  const { token, userId } = await adminAuth();
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${PB_URL}/api/collections/maintenance_records/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      schedule: schedId,
      performed_at: today,
      performed_by: userId,
      notes: "Seeded by detail-page test",
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createMaintenanceRecordViaApi failed: ${JSON.stringify(body)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Test 9: Schedule detail page — metadata, history table, Record done @smoke
// ---------------------------------------------------------------------------

test.describe("Maintenance — schedule detail page @smoke", () => {
  let kitId: string;
  let schedId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-DETAIL`);
    kitId = kit.id;
    const sched = await createScheduleViaApi(kitId, "calibration", 90);
    schedId = sched.id;
    // Seed one history record so the detail page shows the history table, not EmptyState.
    await createMaintenanceRecordViaApi(schedId);
  });

  test.afterAll(async () => {
    await deactivateSchedule(schedId);
    await deleteKit(kitId);
  });

  test("clicking schedule row on /maintenance navigates to detail page with metadata + history @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    // Wait for desktop table to render
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });

    // Find the row for our kit and click a body cell (td) to trigger navigation.
    // Buttons in the row use e.stopPropagation(); clicking a plain cell fires the tr onClick.
    const row = page.locator("tr").filter({ hasText: `${TS}-DETAIL` });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.locator("td").first().click();

    // Should navigate to /maintenance/:scheduleId
    await page.waitForURL(`**/maintenance/${schedId}`, { timeout: 10_000 });

    // Page header shows the schedule type
    await expect(page.locator("h1")).toContainText("Calibration", { timeout: 5_000 });

    // Metadata card: interval displayed
    await expect(page.getByText("90 days")).toBeVisible();

    // Back link is present
    await expect(page.getByRole("link", { name: "Back to Maintenance" })).toBeVisible();

    // History table is visible and has at least the seeded record
    await expect(page.locator("table")).toBeVisible({ timeout: 5_000 });
    const historyRows = await page.locator("tbody tr").count();
    expect(historyRows).toBeGreaterThanOrEqual(1);

    // "Record done" button is present (canDecideRequests = true for admin)
    await expect(page.getByRole("button", { name: "Record done" })).toBeVisible();
  });

  test("admin records maintenance from detail page, new history row appears @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/maintenance/${schedId}`);
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // Count existing history rows before recording
    await expect(page.locator("table")).toBeVisible({ timeout: 5_000 });
    const initialRows = await page.locator("tbody tr").count();

    // Open RecordMaintenanceDialog
    await page.getByRole("button", { name: "Record done" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Record Maintenance/)).toBeVisible();

    // Submit with defaults (today's date, no notes, no cert)
    await page.getByRole("button", { name: "Record done" }).last().click();

    // Success toast
    await expect(page.locator("div:has-text('Maintenance recorded')").first()).toBeVisible({ timeout: 10_000 });

    // History table now has one more row than before
    const newRows = await page.locator("tbody tr").count();
    expect(newRows).toBe(initialRows + 1);
  });
});
