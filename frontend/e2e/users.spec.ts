/**
 * E2E tests for the Users management feature.
 *
 * Backend listRule fix shipped in migration 1778347000_users_admin_listrule.js
 * (admin OR self). Multi-user table tests below now run as regular tests.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

const PB_URL = "http://127.0.0.1:8090";

// ---------------------------------------------------------------------------
// API helpers specific to users tests
// ---------------------------------------------------------------------------

async function getAdminToken(): Promise<string> {
  const res = await fetch(
    `${PB_URL}/api/collections/users/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "logistics@kit.local",
        password: "Pass1234!",
      }),
    }
  );
  if (!res.ok) throw new Error(`Admin auth failed: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

interface CreatedUser {
  id: string;
  email: string;
  role: string;
}

async function createTestUser(
  email: string,
  role: "" | "admin" | "user" | "viewer" = ""
): Promise<CreatedUser> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Pass1234!",
      passwordConfirm: "Pass1234!",
      role,
      emailVisibility: true,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createTestUser failed: ${JSON.stringify(body)}`);
  }
  return res.json() as Promise<CreatedUser>;
}

async function deleteTestUser(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
    method: "DELETE",
    headers: { Authorization: token },
  });
}

async function getUserById(id: string): Promise<CreatedUser | null> {
  const token = await getAdminToken();
  const res = await fetch(
    `${PB_URL}/api/collections/users/records/${id}`,
    { headers: { Authorization: token } }
  );
  if (!res.ok) return null;
  return res.json() as Promise<CreatedUser>;
}

// ---------------------------------------------------------------------------
// Group 1 — Nav and access control (independent of listRule bug)
// ---------------------------------------------------------------------------

test.describe.serial("Users management — nav and access control", () => {
  // -------------------------------------------------------------------------
  // Test 1 — admin sees "Users" link in sidebar
  // -------------------------------------------------------------------------
  test("admin sees Users link in sidebar @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(
      page.getByRole("link", { name: "Users" }),
      "Admin must see a 'Users' nav link in the sidebar"
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 2 — viewer does NOT see Users link
  // -------------------------------------------------------------------------
  test("viewer does not see Users link in sidebar", async ({ page }) => {
    await loginAs(page, "viewer");
    await expect(
      page.getByRole("link", { name: "Users" }),
      "Viewer must NOT see a 'Users' nav link"
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 3 — user role does NOT see Users link
  // -------------------------------------------------------------------------
  test("user role does not see Users link in sidebar", async ({ page }) => {
    await loginAs(page, "user");
    await expect(
      page.getByRole("link", { name: "Users" }),
      "User (non-admin) must NOT see a 'Users' nav link"
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 4 — non-admin navigating directly to /users is redirected
  // -------------------------------------------------------------------------
  test("non-admin direct nav to /users redirects to dashboard", async ({
    page,
  }) => {
    await loginAs(page, "viewer");
    await page.goto("/users");
    // AdminOnly guard returns <Navigate to="/" /> which redirects to /dashboard
    await page.waitForURL("**/dashboard", { timeout: 8_000 });
    await expect(page).toHaveURL(/\/dashboard/, {
      message: "Viewer navigating to /users must be redirected to /dashboard",
    });
  });
});

// ---------------------------------------------------------------------------
// Group 2 — Self-row interactions (work even with current listRule bug,
//           because listRule includes own record)
// ---------------------------------------------------------------------------

test.describe.serial("Users management — self-row and search", () => {
  // -------------------------------------------------------------------------
  // Test 6 — admin CANNOT demote self if last admin
  // Self-row is always visible (listRule: id = @request.auth.id includes self).
  // -------------------------------------------------------------------------
  test("admin cannot demote self when last admin", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/users");

    await expect(page.getByText("Loading…")).not.toBeVisible({
      timeout: 8_000,
    });

    // Self-row is always visible — locate by email
    const selfRow = page
      .getByRole("row")
      .filter({ hasText: "logistics@kit.local" });
    await expect(
      selfRow,
      "The logged-in admin's own row must always be visible"
    ).toBeVisible();

    // Attempt to demote self to "user"
    const roleSelect = selfRow.getByRole("combobox");
    await roleSelect.click();
    await page.getByRole("option", { name: "User" }).click();

    // Expect error toast from PB hook: "Cannot demote the last admin"
    await expect(
      page.getByText(/cannot demote the last admin/i),
      "Error toast must appear when demoting the last admin"
    ).toBeVisible({ timeout: 8_000 });

    // After optimistic-revert, dropdown must show "Admin" again
    await expect(
      selfRow.getByRole("combobox"),
      "Role dropdown must revert to Admin after failed demotion"
    ).toHaveText(/Admin/i, { timeout: 4_000 });

    // Verify persistence via API
    const authRes = await fetch(
      `${PB_URL}/api/collections/users/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: "logistics@kit.local",
          password: "Pass1234!",
        }),
      }
    );
    const { record } = await authRes.json();
    expect(
      record.role,
      "Role must remain 'admin' in PocketBase after failed demotion"
    ).toBe("admin");
  });

  // -------------------------------------------------------------------------
  // Test 8 — search filters the table (uses self-row only)
  // -------------------------------------------------------------------------
  test("search filters table to matching rows", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/users");

    await expect(page.getByText("Loading…")).not.toBeVisible({
      timeout: 8_000,
    });

    // Admin's own row is always visible
    await expect(
      page.getByRole("row").filter({ hasText: "logistics@kit.local" }),
      "Admin row must be visible before search"
    ).toBeVisible();

    // Search matching the admin's email
    await page.getByPlaceholder("Search by email or name…").fill("logistics");
    await expect(
      page.getByRole("row").filter({ hasText: "logistics@kit.local" }),
      "Admin row must remain visible when search matches"
    ).toBeVisible();

    // Search that matches nothing
    await page
      .getByPlaceholder("Search by email or name…")
      .fill("zzz-nomatch-zzz");
    await expect(
      page.getByText("No users found."),
      "'No users found.' must appear when search matches nothing"
    ).toBeVisible();

    // Clear search — admin row returns
    await page.getByPlaceholder("Search by email or name…").fill("");
    await expect(
      page.getByRole("row").filter({ hasText: "logistics@kit.local" }),
      "Admin row must reappear after clearing search"
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Group 3 — Multi-user table tests (admin lists + manages other users)
// ---------------------------------------------------------------------------

test.describe("Users management — multi-user table", () => {
  // -------------------------------------------------------------------------
  // Test 5 — admin promotes pending user to "user" role
  // -------------------------------------------------------------------------
  test("admin can promote pending user to user role", async ({ page }) => {
    const ts = Date.now();
    const email = `pending-${ts}@test.local`;

    const created = await createTestUser(email, "");
    const userId = created.id;

    try {
      await loginAs(page, "admin");
      await page.goto("/users");

      await expect(page.getByText("Loading…")).not.toBeVisible({
        timeout: 8_000,
      });

      // This will fail — row for other user not visible due to listRule bug
      const pendingRow = page.getByRole("row").filter({ hasText: email });
      await expect(
        pendingRow,
        `Row for ${email} must be visible (blocked by listRule bug)`
      ).toBeVisible({ timeout: 5_000 });

      // Assert "Pending" badge
      await expect(
        pendingRow.getByText("Pending", { exact: true }),
        "Pending badge must appear for role-less user"
      ).toBeVisible();

      // Change role to "user"
      const roleSelect = pendingRow.getByRole("combobox");
      await roleSelect.click();
      await page.getByRole("option", { name: "User" }).click();

      await expect(
        page.getByText("Role updated", { exact: true }),
        "Success toast must appear after role change"
      ).toBeVisible({ timeout: 6_000 });

      // Verify via API
      const updated = await getUserById(userId);
      expect(updated?.role, "Role must be 'user' in PocketBase").toBe("user");
    } finally {
      if (userId) await deleteTestUser(userId);
    }
  });

  // -------------------------------------------------------------------------
  // Test 6 — admin demotes another admin (when ≥2 admins exist)
  // KNOWN_BUG: same listRule issue
  // -------------------------------------------------------------------------
  test("admin can demote another admin when ≥2 admins exist", async ({
    page,
  }) => {
    const ts = Date.now();
    const email = `extra-admin-${ts}@test.local`;

    const created = await createTestUser(email, "admin");
    const userId = created.id;

    try {
      await loginAs(page, "admin");
      await page.goto("/users");

      await expect(page.getByText("Loading…")).not.toBeVisible({
        timeout: 8_000,
      });

      const targetRow = page.getByRole("row").filter({ hasText: email });
      await expect(
        targetRow,
        `Row for ${email} must be visible (blocked by listRule bug)`
      ).toBeVisible({ timeout: 5_000 });

      // Change role to "user"
      const roleSelect = targetRow.getByRole("combobox");
      await roleSelect.click();
      await page.getByRole("option", { name: "User" }).click();

      await expect(
        page.getByText("Role updated", { exact: true }),
        "Success toast must appear"
      ).toBeVisible({ timeout: 6_000 });

      const updated = await getUserById(userId);
      expect(updated?.role, "Role must be 'user' after demotion").toBe("user");
    } finally {
      if (userId) await deleteTestUser(userId);
    }
  });

  // -------------------------------------------------------------------------
  // Test 7 — "Pending" badge shown for user with empty role
  // KNOWN_BUG: same listRule issue
  // -------------------------------------------------------------------------
  test("Pending badge shown for user with empty role", async ({ page }) => {
    const ts = Date.now();
    const email = `pending-badge-${ts}@test.local`;

    const created = await createTestUser(email, "");
    const userId = created.id;

    try {
      await loginAs(page, "admin");
      await page.goto("/users");

      await expect(page.getByText("Loading…")).not.toBeVisible({
        timeout: 8_000,
      });

      const pendingRow = page.getByRole("row").filter({ hasText: email });
      await expect(
        pendingRow,
        `Row for ${email} must be visible (blocked by listRule bug)`
      ).toBeVisible({ timeout: 5_000 });

      await expect(
        pendingRow.getByText("Pending", { exact: true }),
        "Pending badge must appear in role cell for a user with empty role"
      ).toBeVisible();
    } finally {
      if (userId) await deleteTestUser(userId);
    }
  });
});
