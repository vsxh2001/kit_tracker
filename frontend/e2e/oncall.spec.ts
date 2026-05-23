/**
 * On-call schedule flows.
 *
 * Coverage:
 *   1. Admin can add a shift via UI @smoke
 *   2. Non-admin (user role) sees /oncall (read-only, no add button)
 *   3. Non-admin role cannot assign a user with role=user (dropdown only shows admin/technician)
 *   4. Sidebar shows "On call: <name>" when an active shift exists
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createOnCallShift,
  deleteOnCallShift,
  getAdminUserId,
} from "./helpers/api";

const TS = `oncall-${Date.now()}`;

// ---------------------------------------------------------------------------
// Test 1: Admin can add a shift via UI
// ---------------------------------------------------------------------------

test.describe("OnCall — admin add shift @smoke", () => {
  // We'll clean up any shift created by the test by tracking the page
  test("admin can add shift via UI @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/oncall");

    await expect(page.getByRole("heading", { name: "On-Call", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /add shift/i }).first()).toBeVisible();

    await page.getByRole("button", { name: /add shift/i }).first().click();
    await expect(page.getByRole("heading", { name: /add on-call shift/i })).toBeVisible();

    // Select the first eligible user from the dropdown
    const userSelect = page.locator("#shift-user");
    await userSelect.waitFor({ state: "visible" });
    // Select the second option (first non-placeholder)
    const optionCount = await userSelect.locator("option").count();
    expect(optionCount).toBeGreaterThan(1);
    await userSelect.selectOption({ index: 1 });

    // Set start and end datetime-local inputs
    const now = new Date();
    const future1h = new Date(now.getTime() + 60 * 60 * 1000);
    const future2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    function toInputValue(d: Date) {
      return d.toISOString().slice(0, 16);
    }

    await page.locator("#shift-start").fill(toInputValue(future1h));
    await page.locator("#shift-end").fill(toInputValue(future2h));
    await page.locator("#shift-notes").fill(`${TS}-e2e-note`);

    await page.getByRole("button", { name: /^add shift$/i }).click();

    // Dialog should close
    await expect(page.getByRole("heading", { name: /add on-call shift/i })).not.toBeVisible({ timeout: 10000 });

    // The new shift should appear somewhere in the table/cards
    await expect(page.getByText(`${TS}-e2e-note`).first()).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test 2: Non-admin sees read-only /oncall (no add button)
// ---------------------------------------------------------------------------

test.describe("OnCall — non-admin read-only", () => {
  let shiftId: string;
  let adminId: string;

  test.beforeAll(async () => {
    adminId = await getAdminUserId();
    const now = new Date();
    const future1h = new Date(now.getTime() + 60 * 60 * 1000);
    const shift = await createOnCallShift({
      userId: adminId,
      startAt: future1h.toISOString(),
      endAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      notes: `${TS}-readonly`,
    });
    shiftId = shift.id;
  });

  test.afterAll(async () => {
    if (shiftId) await deleteOnCallShift(shiftId);
  });

  test("user role sees /oncall read-only, no add button", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/oncall");

    await expect(page.getByRole("heading", { name: "On-Call", exact: true })).toBeVisible();
    // No "Add shift" button for non-admin
    await expect(page.getByRole("button", { name: /add shift/i })).not.toBeVisible();
    // No edit/delete buttons
    await expect(page.getByRole("button", { name: /edit shift/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Non-admin cannot select user with role=user from dropdown
//         (dropdown limited to admin/technician roles)
// ---------------------------------------------------------------------------

test.describe("OnCall — add dialog filters to admin/technician users", () => {
  test("add shift dialog only shows admin/technician users in dropdown", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/oncall");

    await page.getByRole("button", { name: /add shift/i }).first().click();
    await expect(page.getByRole("heading", { name: /add on-call shift/i })).toBeVisible();

    const userSelect = page.locator("#shift-user");
    await userSelect.waitFor({ state: "visible" });

    // Get all options except the placeholder
    const options = await userSelect.locator("option").allTextContents();
    const nonPlaceholder = options.filter((t) => !t.includes("Select user"));

    // All options should include (admin) or (technician), NOT (user) or (viewer)
    for (const opt of nonPlaceholder) {
      expect(opt).toMatch(/\((admin|technician)\)/);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: Sidebar shows "On call: <name>" when an active shift exists
// ---------------------------------------------------------------------------

test.describe("OnCall — sidebar badge", () => {
  let shiftId: string;
  let adminId: string;

  test.beforeAll(async () => {
    adminId = await getAdminUserId();
    // Create an active shift (start in the past, end in the future)
    const now = new Date();
    const past1h = new Date(now.getTime() - 60 * 60 * 1000);
    const future1h = new Date(now.getTime() + 60 * 60 * 1000);
    const shift = await createOnCallShift({
      userId: adminId,
      startAt: past1h.toISOString(),
      endAt: future1h.toISOString(),
      notes: `${TS}-active`,
    });
    shiftId = shift.id;
  });

  test.afterAll(async () => {
    if (shiftId) await deleteOnCallShift(shiftId);
  });

  test("sidebar shows 'On call: <name>' when active shift exists @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");
    await expect(page.getByText(/^On call:/i).first()).toBeVisible({ timeout: 8000 });
  });
});
