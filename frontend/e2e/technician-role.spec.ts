/**
 * technician-role.spec.ts
 *
 * Full role-matrix coverage for the "technician" role feature.
 * Tests every capability in the role matrix for all four roles:
 * viewer, user, technician, admin.
 *
 * Also includes 4 P0 security tests (REST-level enforcement).
 *
 * Structure: parameterised describe over roles where assertions vary per role,
 * plus a dedicated P0 security block.
 *
 * Requires: PB running on $PB_URL (default :8110) + Vite on $PLAYWRIGHT_TEST_BASE_URL (default :5183).
 * Seed: logistics@kit.local (admin), requester@kit.local (user), viewer@kit.local (viewer),
 *       tech@kit.local (technician) — all Pass1234!
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createTestKit,
  createTestEntity,
  createTestRequest,
  deleteKit,
  deactivateEntity,
  getAdminToken,
  getAdminUserId,
  countTransactionsForKit,
  getLatestTransactionForKit,
  getRequest,
} from "./helpers/api";

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

type RoleName = "viewer" | "user" | "technician" | "admin";

const CREDS: Record<RoleName, { email: string; password: string }> = {
  viewer: { email: "viewer@kit.local", password: "Pass1234!" },
  user: { email: "requester@kit.local", password: "Pass1234!" },
  technician: { email: "tech@kit.local", password: "Pass1234!" },
  admin: { email: "logistics@kit.local", password: "Pass1234!" },
};

async function loginAs(page: Page, role: RoleName): Promise<void> {
  const { email, password } = CREDS[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 12_000 });
}

// ---------------------------------------------------------------------------
// Per-role matrix capability expectations
// ---------------------------------------------------------------------------

type MatrixRow = {
  canSeeNewKitButton: boolean;
  canSeeMoveKitButton: boolean;
  canSeeEditRetireKit: boolean;
  canSeeNewRequestButton: boolean;
  canSeeApproveRejectButtons: boolean;
  canSeeDeleteDangerZone: boolean;
  canSeeUsersNavLink: boolean;
  usersPageRedirects: boolean;
};

const MATRIX: Record<RoleName, MatrixRow> = {
  viewer: {
    canSeeNewKitButton: false,
    canSeeMoveKitButton: false,
    canSeeEditRetireKit: false,
    canSeeNewRequestButton: false,
    canSeeApproveRejectButtons: false,
    canSeeDeleteDangerZone: false,
    canSeeUsersNavLink: false,
    usersPageRedirects: true,
  },
  user: {
    canSeeNewKitButton: false,
    canSeeMoveKitButton: false,
    canSeeEditRetireKit: false,
    canSeeNewRequestButton: true,
    canSeeApproveRejectButtons: false,
    canSeeDeleteDangerZone: false,
    canSeeUsersNavLink: false,
    usersPageRedirects: true,
  },
  technician: {
    canSeeNewKitButton: true,
    canSeeMoveKitButton: true,
    canSeeEditRetireKit: true,
    canSeeNewRequestButton: true,
    canSeeApproveRejectButtons: true,
    canSeeDeleteDangerZone: false,
    canSeeUsersNavLink: false,
    usersPageRedirects: true,
  },
  admin: {
    canSeeNewKitButton: true,
    canSeeMoveKitButton: true,
    canSeeEditRetireKit: true,
    canSeeNewRequestButton: true,
    canSeeApproveRejectButtons: true,
    canSeeDeleteDangerZone: true,
    canSeeUsersNavLink: true,
    usersPageRedirects: false,
  },
};

// ---------------------------------------------------------------------------
// Shared test data (seeded once per file run)
// ---------------------------------------------------------------------------

let testKitId = "";
let testKitSerial = "";
let testEntityId = "";
let testEntityName = "";

test.beforeAll(async () => {
  const suffix = Date.now();
  testKitSerial = `TECH-ROLE-${suffix}`;
  const kit = await createTestKit(testKitSerial, "role-matrix test kit");
  testKitId = kit.id;

  testEntityName = `TechEntity-${suffix}`;
  const entity = await createTestEntity(testEntityName, "", "storage");
  testEntityId = entity.id;
});

test.afterAll(async () => {
  if (testKitId) await deleteKit(testKitId);
  if (testEntityId) await deactivateEntity(testEntityId);
});

// ---------------------------------------------------------------------------
// Helper to get technician's user ID + token (for REST security tests)
// ---------------------------------------------------------------------------

async function getTechnicianCredentials(): Promise<{
  token: string;
  userId: string;
}> {
  const res = await fetch(
    `${PB_URL}/api/collections/users/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "tech@kit.local",
        password: "Pass1234!",
      }),
    }
  );
  if (!res.ok) throw new Error(`Technician auth failed: ${res.status}`);
  const data = await res.json();
  return { token: data.token, userId: data.record.id };
}

async function getUserCredentials(role: "user"): Promise<{
  token: string;
  userId: string;
}> {
  const res = await fetch(
    `${PB_URL}/api/collections/users/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: CREDS[role].email,
        password: CREDS[role].password,
      }),
    }
  );
  if (!res.ok) throw new Error(`${role} auth failed: ${res.status}`);
  const data = await res.json();
  return { token: data.token, userId: data.record.id };
}

// ---------------------------------------------------------------------------
// Role matrix tests — parameterized over all four roles
// ---------------------------------------------------------------------------

const ROLES: RoleName[] = ["viewer", "user", "technician", "admin"];

for (const role of ROLES) {
  test.describe(`Role: ${role}`, () => {
    const m = MATRIX[role];

    // Login + reach dashboard
    test(`${role} — login and reach dashboard${role === "admin" ? " @smoke" : ""}`, async ({ page }) => {
      await loginAs(page, role);
      await expect(page).toHaveURL(/dashboard/, {
        message: `${role} should land on dashboard after login`,
      });
      await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({
        message: `${role} should see Dashboard heading`,
      });
    });

    // See /kits list (all roles)
    test(`${role} — can see /kits list`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto("/kits");
      await expect(
        page.getByRole("heading", { name: /kits/i }).first()
      ).toBeVisible({ message: `${role} should see Kits page heading` });
    });

    // New kit button visibility
    test(`${role} — New kit button: ${m.canSeeNewKitButton ? "visible" : "hidden"}`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto("/kits");
      const btn = page.getByRole("button", { name: /new kit/i });
      if (m.canSeeNewKitButton) {
        await expect(btn).toBeVisible({
          message: `${role} should see New kit button`,
        });
      } else {
        await expect(btn).not.toBeVisible({
          message: `${role} should NOT see New kit button`,
        });
      }
    });

    // Move kit button on kit detail page
    test(`${role} — Move kit button on /kits/:id: ${m.canSeeMoveKitButton ? "visible" : "hidden"}`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto(`/kits/${testKitId}`);
      await page.waitForLoadState("networkidle");
      const btn = page.getByRole("button", { name: /move kit/i });
      if (m.canSeeMoveKitButton) {
        await expect(btn).toBeVisible({
          message: `${role} should see Move kit button on kit detail`,
        });
      } else {
        await expect(btn).not.toBeVisible({
          message: `${role} should NOT see Move kit button on kit detail`,
        });
      }
    });

    // Edit / Retire kit buttons (admin-only)
    test(`${role} — Edit/Retire kit buttons: ${m.canSeeEditRetireKit ? "visible" : "hidden"}`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto(`/kits/${testKitId}`);
      await page.waitForLoadState("networkidle");
      const editBtn = page.getByRole("button", { name: /edit/i });
      const retireBtn = page.getByRole("button", { name: /retire kit/i });
      if (m.canSeeEditRetireKit) {
        await expect(editBtn).toBeVisible({
          message: `${role} should see Edit button`,
        });
        await expect(retireBtn).toBeVisible({
          message: `${role} should see Retire kit button`,
        });
      } else {
        await expect(editBtn).not.toBeVisible({
          message: `${role} should NOT see Edit button`,
        });
        await expect(retireBtn).not.toBeVisible({
          message: `${role} should NOT see Retire kit button`,
        });
      }
    });

    // New request button
    test(`${role} — New request button: ${m.canSeeNewRequestButton ? "visible" : "hidden"}`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto("/requests");
      await page.waitForLoadState("networkidle");
      const btn = page.getByRole("button", { name: /new request/i });
      if (m.canSeeNewRequestButton) {
        await expect(btn).toBeVisible({
          message: `${role} should see New request button`,
        });
      } else {
        await expect(btn).not.toBeVisible({
          message: `${role} should NOT see New request button`,
        });
      }
    });

    // Approve/Reject buttons on open request detail (decision-makers only)
    test(`${role} — Approve/Reject on open request: ${m.canSeeApproveRejectButtons ? "visible" : "hidden"}`, async ({ page }) => {
      // Create a fresh open request owned by admin so ownership doesn't interfere
      const adminId = await getAdminUserId();
      const req = await createTestRequest({ requesterId: adminId });

      try {
        await loginAs(page, role);
        await page.goto(`/requests/${req.id}`);
        await page.waitForLoadState("networkidle");

        const approveBtn = page.getByRole("button", { name: /approve/i });
        const rejectBtn = page.getByRole("button", { name: /reject/i });

        if (m.canSeeApproveRejectButtons) {
          await expect(approveBtn).toBeVisible({
            message: `${role} should see Approve button`,
          });
          await expect(rejectBtn).toBeVisible({
            message: `${role} should see Reject button`,
          });
        } else {
          await expect(approveBtn).not.toBeVisible({
            message: `${role} should NOT see Approve button`,
          });
          await expect(rejectBtn).not.toBeVisible({
            message: `${role} should NOT see Reject button`,
          });
        }
      } finally {
        // Clean up: set to cancelled so it doesn't pollute other tests
        const token = await getAdminToken();
        await fetch(`${PB_URL}/api/collections/requests/records/${req.id}`, {
          method: "PATCH",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        });
      }
    });

    // Delete danger zone — only visible to admin on terminal-state requests
    test(`${role} — Delete danger zone on fulfilled request: ${m.canSeeDeleteDangerZone ? "visible" : "hidden"}`, async ({ page }) => {
      // Create a fulfilled request to trigger the danger-zone card
      const adminId = await getAdminUserId();
      const req = await createTestRequest({
        requesterId: adminId,
        status: "fulfilled",
      });

      try {
        await loginAs(page, role);
        await page.goto(`/requests/${req.id}`);
        await page.waitForLoadState("networkidle");

        // Danger zone card has heading "Danger zone"
        const dangerZone = page.getByRole("heading", { name: /danger zone/i });

        if (m.canSeeDeleteDangerZone) {
          await expect(dangerZone).toBeVisible({
            message: `${role} should see Danger zone on fulfilled request`,
          });
        } else {
          await expect(dangerZone).not.toBeVisible({
            message: `${role} should NOT see Danger zone`,
          });
        }
      } finally {
        await fetch(`${PB_URL}/api/collections/requests/records/${req.id}`, {
          method: "DELETE",
          headers: { Authorization: await getAdminToken() },
        });
      }
    });

    // Users nav link in sidebar
    test(`${role} — Users link in sidebar: ${m.canSeeUsersNavLink ? "visible" : "hidden"}`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto("/dashboard");
      const usersLink = page.getByRole("link", { name: /^users$/i });
      if (m.canSeeUsersNavLink) {
        await expect(usersLink).toBeVisible({
          message: `${role} should see Users nav link`,
        });
      } else {
        await expect(usersLink).not.toBeVisible({
          message: `${role} should NOT see Users nav link`,
        });
      }
    });

    // Direct GET /users redirect behaviour
    test(`${role} — direct /users ${m.usersPageRedirects ? "redirects to dashboard" : "shows Users page"}`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto("/users");
      if (m.usersPageRedirects) {
        await page.waitForURL(/dashboard/, { timeout: 8_000 });
        await expect(page).toHaveURL(/dashboard/, {
          message: `${role} should be redirected from /users to dashboard`,
        });
      } else {
        // Admin sees the users page
        await expect(page.getByRole("heading", { name: /users/i })).toBeVisible({
          message: `${role} should see Users page`,
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Technician happy paths (UI interactions)
// ---------------------------------------------------------------------------

test.describe("Technician UI happy paths", () => {
  let techKitId = "";
  let techKitSerial = "";

  test.beforeAll(async () => {
    const suffix = `TECH-UI-${Date.now()}`;
    techKitSerial = suffix;
    const kit = await createTestKit(techKitSerial, "technician UI test");
    techKitId = kit.id;
  });

  test.afterAll(async () => {
    if (techKitId) await deleteKit(techKitId);
  });

  test("technician can move a kit via UI (transaction created)", async ({ page }) => {
    const countBefore = await countTransactionsForKit(techKitId);

    await loginAs(page, "technician");
    await page.goto(`/kits/${techKitId}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /move kit/i }).click();
    // Move dialog should open
    await expect(page.getByRole("dialog")).toBeVisible();

    // Select destination entity via Radix combobox
    const toTrigger = page.locator('[role="combobox"]').filter({ hasText: /select|entity/i });
    await toTrigger.first().click();
    await page.getByRole("option", { name: testEntityName }).click();

    await page.getByRole("button", { name: /confirm|move|save/i }).click();

    // Dialog should close
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 8_000 });

    // Verify transaction was created in DB
    const countAfter = await countTransactionsForKit(techKitId);
    expect(countAfter, "A new transaction should have been created").toBe(countBefore + 1);

    const latest = await getLatestTransactionForKit(techKitId);
    expect(latest?.to_entity, "Latest transaction to_entity should be testEntityId").toBe(
      testEntityId
    );
  });

  test("technician can approve an open request (status persists in DB)", async ({ page }) => {
    const adminId = await getAdminUserId();
    const req = await createTestRequest({ requesterId: adminId });

    await loginAs(page, "technician");
    await page.goto(`/requests/${req.id}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: /approve/i })
    ).toBeVisible();
    await page.getByRole("button", { name: /approve/i }).click();

    // Wait for toast or status badge change
    await page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/collections/requests/records/${req.id}`) &&
        resp.request().method() === "PATCH",
      { timeout: 10_000 }
    );

    // DB should reflect approved
    const updated = await getRequest(req.id);
    expect(updated.status, "Request status should be 'approved' after technician approves").toBe(
      "approved"
    );
  });

  test("technician can reject an open request (status persists in DB)", async ({ page }) => {
    const adminId = await getAdminUserId();
    const req = await createTestRequest({ requesterId: adminId });

    await loginAs(page, "technician");
    await page.goto(`/requests/${req.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /reject/i }).click();

    await page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/collections/requests/records/${req.id}`) &&
        resp.request().method() === "PATCH",
      { timeout: 10_000 }
    );

    const updated = await getRequest(req.id);
    expect(updated.status, "Request status should be 'rejected' after technician rejects").toBe(
      "rejected"
    );
  });

  test("technician can fulfill an approved request (transaction + status)", async ({ page }) => {
    const adminId = await getAdminUserId();
    // Need a kit + entity already set on the request so Fulfill doesn't error
    const req = await createTestRequest({
      requesterId: adminId,
      status: "approved",
      designatedKitId: techKitId,
      targetEntityId: testEntityId,
    });

    const txCountBefore = await countTransactionsForKit(techKitId);

    await loginAs(page, "technician");
    await page.goto(`/requests/${req.id}`);
    await page.waitForLoadState("networkidle");

    // Fulfill button present (status === approved)
    const fulfillBtn = page.getByRole("button", { name: /fulfill/i });
    await expect(fulfillBtn).toBeVisible();
    await fulfillBtn.click();

    // fulfillRequest does: POST transaction → PATCH status (fulfilled)
    // Wait specifically for the status PATCH that sets status=fulfilled
    await page.waitForResponse(
      async (resp) => {
        if (
          !resp.url().includes(`/api/collections/requests/records/${req.id}`) ||
          resp.request().method() !== "PATCH"
        ) {
          return false;
        }
        try {
          const body = await resp.json();
          return body.status === "fulfilled";
        } catch {
          return false;
        }
      },
      { timeout: 15_000 }
    );

    // DB assertions: status = fulfilled AND new transaction
    const [updatedReq, txCountAfter] = await Promise.all([
      getRequest(req.id),
      countTransactionsForKit(techKitId),
    ]);

    expect(
      updatedReq.status,
      "Request status should be 'fulfilled' after technician fulfills"
    ).toBe("fulfilled");
    expect(
      txCountAfter,
      "A transaction should have been created when fulfilling"
    ).toBeGreaterThan(txCountBefore);
  });
});

// ---------------------------------------------------------------------------
// P0 Security tests (REST-level, no UI)
// ---------------------------------------------------------------------------

test.describe("P0 Security: REST enforcement", () => {
  test("non-admin cannot change another user's role via PATCH (blocked by hook)", async () => {
    // Get admin user ID to attempt patching
    const adminId = await getAdminUserId();
    const { token: techToken } = await getTechnicianCredentials();

    const res = await fetch(
      `${PB_URL}/api/collections/users/records/${adminId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: techToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "viewer" }),
      }
    );

    expect(
      res.ok,
      "Technician PATCH to change another user's role must be rejected"
    ).toBe(false);
    expect(
      [400, 403, 404],
      "Must return 400 (hook), 403 (rule), or 404"
    ).toContain(res.status);

    // Verify admin's role was NOT changed
    const adminToken = await getAdminToken();
    const check = await fetch(
      `${PB_URL}/api/collections/users/records/${adminId}`,
      { headers: { Authorization: adminToken } }
    );
    const rec = await check.json();
    expect(rec.role, "Admin's role must remain 'admin'").toBe("admin");
  });

  test("regular user role cannot create a transaction (blocked by createRule)", async () => {
    const { token: userToken, userId } = await getUserCredentials("user");
    const txCountBefore = await countTransactionsForKit(testKitId);

    const res = await fetch(
      `${PB_URL}/api/collections/transactions/records`,
      {
        method: "POST",
        headers: {
          Authorization: userToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kit: testKitId,
          to_entity: testEntityId,
          timestamp: new Date().toISOString(),
          created_by: userId,
        }),
      }
    );

    expect(
      res.ok,
      "User role must NOT be able to create transactions (createRule restricts to admin/technician)"
    ).toBe(false);
    expect([400, 403], "Must return 400 or 403").toContain(res.status);

    // Verify no transaction was added
    const txCountAfter = await countTransactionsForKit(testKitId);
    expect(txCountAfter, "No transaction should have been created").toBe(txCountBefore);
  });

  test("technician CAN create a transaction via REST", async () => {
    const { token: techToken, userId: techUserId } =
      await getTechnicianCredentials();

    const txCountBefore = await countTransactionsForKit(testKitId);

    const res = await fetch(
      `${PB_URL}/api/collections/transactions/records`,
      {
        method: "POST",
        headers: {
          Authorization: techToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kit: testKitId,
          to_entity: testEntityId,
          timestamp: new Date().toISOString(),
          created_by: techUserId,
        }),
      }
    );

    expect(
      res.ok,
      "Technician must be able to create transactions via REST"
    ).toBe(true);

    const txCountAfter = await countTransactionsForKit(testKitId);
    expect(
      txCountAfter,
      "Transaction count should have increased"
    ).toBe(txCountBefore + 1);
  });

  test("technician self-promotion to admin is blocked by role_change_check hook", async () => {
    const { token: techToken, userId: techUserId } =
      await getTechnicianCredentials();

    const res = await fetch(
      `${PB_URL}/api/collections/users/records/${techUserId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: techToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "admin" }),
      }
    );

    expect(
      res.ok,
      "Technician self-promotion to admin must be blocked by role_change_check hook"
    ).toBe(false);
    expect(
      [400, 403],
      "Hook should return 400 (BadRequestError)"
    ).toContain(res.status);

    // Verify technician's role is still 'technician' in DB
    const adminToken = await getAdminToken();
    const check = await fetch(
      `${PB_URL}/api/collections/users/records/${techUserId}`,
      { headers: { Authorization: adminToken } }
    );
    const rec = await check.json();
    expect(
      rec.role,
      "Technician role must still be 'technician' after self-promotion attempt"
    ).toBe("technician");
  });
});
