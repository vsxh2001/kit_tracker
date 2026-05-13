/**
 * Combined E2E spec: Deny flow + User Profile (Phase 2)
 *
 * Coverage:
 *   1. Admin denies a pending user → user appears with role=denied + denial_notes visible
 *   2. Denied user tries password login → sees denied banner (not generic error)
 *   3. Admin restores denied user (sets to "user") → user can log in
 *   4. Authenticated user edits own profile (phone, title, name) → values persist
 *   5. Admin edits another user's phone/title → values persist
 *   6. /oncall page shows phone column for on-call users with phone
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestUser,
  deleteTestUser,
  getUserById,
  patchUser,
  createOnCallShift,
  deleteOnCallShift,
  getAdminUserId,
} from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// ---------------------------------------------------------------------------
// 1. Admin denies a pending user → user appears with role=denied + denial_notes
// ---------------------------------------------------------------------------

test.describe("Deny flow — admin denies pending user", () => {
  let userId = "";
  const ts = Date.now();
  const email = `deny-pending-${ts}@test.local`;

  test.beforeAll(async () => {
    const u = await createTestUser(email, "");
    userId = u.id;
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
  });

  test("admin denies a pending user and denial_notes appears in row", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/users");

    await expect(page.getByText("Loading…")).not.toBeVisible({ timeout: 8_000 });

    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 6_000 });

    // Open role select and choose Denied
    const roleSelect = row.getByRole("combobox");
    await roleSelect.click();
    await page.getByRole("option", { name: "Denied" }).click();

    // Denial modal should appear
    await expect(page.getByRole("heading", { name: /deny user access/i })).toBeVisible({ timeout: 4_000 });

    // Fill denial notes and confirm
    await page.locator("#denial-notes").fill("Account rejected — test denial");
    await page.getByRole("button", { name: /deny user/i }).click();

    // Success toast
    await expect(page.getByText(/user denied/i)).toBeVisible({ timeout: 6_000 });

    // Row should show denial_notes inline
    const updatedRow = page.getByRole("row").filter({ hasText: email });
    await expect(updatedRow.getByText("Account rejected — test denial")).toBeVisible({ timeout: 4_000 });

    // Verify via API
    const u = await getUserById(userId);
    expect(u?.role).toBe("denied");
    expect(u?.denial_notes).toBe("Account rejected — test denial");
  });
});

// ---------------------------------------------------------------------------
// 2. Denied user tries password login → sees denied banner
// ---------------------------------------------------------------------------

test.describe("Deny flow — denied user sees amber banner on login", () => {
  let userId = "";
  const ts = Date.now();
  const email = `deny-login-${ts}@test.local`;

  test.beforeAll(async () => {
    const u = await createTestUser(email, "");
    userId = u.id;
    await patchUser(userId, { role: "denied", denial_notes: "Denied for testing" });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
  });

  test("denied user sees amber denied banner, not generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("Pass1234!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // Should NOT navigate to dashboard
    // The amber banner should appear
    await expect(
      page.getByText("Your account has been denied. Contact administrator.")
    ).toBeVisible({ timeout: 8_000 });

    // Should still be on /login
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// 3. Admin restores denied user → user can log in
// ---------------------------------------------------------------------------

test.describe("Deny flow — restore denied user", () => {
  let userId = "";
  const ts = Date.now();
  const email = `deny-restore-${ts}@test.local`;

  test.beforeAll(async () => {
    const u = await createTestUser(email, "");
    userId = u.id;
    await patchUser(userId, { role: "denied", denial_notes: "Will be restored" });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
  });

  test("admin restores denied user to 'user' role", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/users");
    await expect(page.getByText("Loading…")).not.toBeVisible({ timeout: 8_000 });

    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 6_000 });

    const roleSelect = row.getByRole("combobox");
    await roleSelect.click();
    await page.getByRole("option", { name: "User" }).click();

    await expect(page.getByText("Role updated", { exact: true })).toBeVisible({ timeout: 6_000 });

    // Verify via API
    const u = await getUserById(userId);
    expect(u?.role).toBe("user");
    expect(u?.denial_notes ?? "").toBe("");
  });

  test("restored user can log in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("Pass1234!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.waitForURL("**/dashboard", { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

// ---------------------------------------------------------------------------
// 4. Authenticated user edits own profile (phone, title, name) → values persist
// ---------------------------------------------------------------------------

test.describe("Profile — self-edit", () => {
  test("authenticated user can edit own profile and values persist", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible({ timeout: 6_000 });

    const ts = Date.now();
    const newName = `Test User ${ts}`;
    const newPhone = `+1555${ts.toString().slice(-7)}`;
    const newTitle = `QA Engineer ${ts}`;

    await page.locator("#profile-name").fill(newName);
    await page.locator("#profile-phone").fill(newPhone);
    await page.locator("#profile-title").fill(newTitle);

    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText("Profile saved", { exact: true })).toBeVisible({ timeout: 6_000 });

    // Reload and verify values persist
    await page.reload();
    await expect(page.locator("#profile-name")).toHaveValue(newName, { timeout: 6_000 });
    await expect(page.locator("#profile-phone")).toHaveValue(newPhone);
    await expect(page.locator("#profile-title")).toHaveValue(newTitle);
  });
});

// ---------------------------------------------------------------------------
// 5. Admin edits another user's phone/title → values persist
// ---------------------------------------------------------------------------

test.describe("Profile — admin edits another user's phone/title", () => {
  let userId = "";
  const ts = Date.now();
  const email = `profile-edit-${ts}@test.local`;

  test.beforeAll(async () => {
    const u = await createTestUser(email, "user");
    userId = u.id;
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId).catch(() => {});
  });

  test("admin can edit another user phone and title via pencil dialog", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/users");
    await expect(page.getByText("Loading…")).not.toBeVisible({ timeout: 8_000 });

    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 6_000 });

    // Click pencil edit button for the row
    await row.getByRole("button", { name: new RegExp(`Edit ${email}`, "i") }).click();

    // Edit dialog opens
    await expect(page.getByRole("heading", { name: /edit contact info/i })).toBeVisible({ timeout: 4_000 });

    const newPhone = `+1444${ts.toString().slice(-7)}`;
    const newTitle = `Admin-Set Title ${ts}`;

    await page.locator("#edit-phone").fill(newPhone);
    await page.locator("#edit-title").fill(newTitle);
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText("Profile updated")).toBeVisible({ timeout: 6_000 });

    // Verify via API
    const u = await getUserById(userId);
    expect(u?.phone).toBe(newPhone);
    expect(u?.title).toBe(newTitle);
  });
});

// ---------------------------------------------------------------------------
// 6. /oncall page shows phone column for on-call users with phone
// ---------------------------------------------------------------------------

test.describe("OnCall — phone column shows for users with phone", () => {
  let shiftId = "";
  let adminId = "";
  const testPhone = "+15550001234";

  test.beforeAll(async () => {
    adminId = await getAdminUserId();
    // Patch admin to have a phone number
    await patchUser(adminId, { phone: testPhone });

    // Create an active shift
    const now = new Date();
    const past1h = new Date(now.getTime() - 60 * 60 * 1000);
    const future1h = new Date(now.getTime() + 60 * 60 * 1000);
    const shift = await createOnCallShift({
      userId: adminId,
      startAt: past1h.toISOString(),
      endAt: future1h.toISOString(),
      notes: "phone-col-test",
    });
    shiftId = shift.id;
  });

  test.afterAll(async () => {
    if (shiftId) await deleteOnCallShift(shiftId).catch(() => {});
    // Clear phone from admin
    if (adminId) await patchUser(adminId, { phone: "" }).catch(() => {});
  });

  test("/oncall page shows phone column with tel: link for user with phone", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/oncall");

    await expect(page.getByRole("heading", { name: "On-Call", exact: true })).toBeVisible();
    await expect(page.getByText("Loading…")).not.toBeVisible({ timeout: 8_000 });

    // Phone column header should be present
    await expect(page.getByRole("columnheader", { name: /phone/i })).toBeVisible({ timeout: 4_000 });

    // tel: link should appear
    const telLink = page.locator(`a[href="tel:${testPhone}"]`).first();
    await expect(telLink).toBeVisible({ timeout: 4_000 });
    await expect(telLink).toContainText(testPhone);
  });
});

// ---------------------------------------------------------------------------
// Utility: direct API auth check for restored user
// ---------------------------------------------------------------------------

async function canAuthWithPassword(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  return res.ok;
}

// Suppress unused warning — used for restore flow validation
void canAuthWithPassword;
