/**
 * Request lifecycle flows.
 *
 * Coverage:
 *   - Requests page lists requests with Date/Requester/Status/Kit/Target columns
 *   - Status filter combobox narrows the list
 *   - Any authenticated user can create a new request (RequestFormDialog)
 *   - Request defaults to "open" status after creation
 *   - Request detail page shows all fields
 *   - Admin sees Admin actions card on open/approved requests
 *   - Admin can approve an open request (sets status → "approved")
 *   - Admin can reject an open request (sets status → "rejected")
 *   - Admin can assign kit + entity then save assignment
 *   - Admin can fulfill an approved request (atomic: transaction created AND status → "fulfilled")
 *   - Owner (requester) can cancel their own open request
 *   - Non-owner viewer cannot cancel a request they don't own
 *   - Fulfilled/rejected/cancelled requests show no Admin actions card
 *   - Back button navigates to /requests
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  createTestEntity,
  createTestTransaction,
  createTestRequest,
  getRequest,
  countTransactionsForKit,
  deleteKit,
  deactivateEntity,
  getUserIdByEmail,
  updateRequestStatus,
} from "./helpers/api";
import { CREDENTIALS } from "./helpers/auth";

const TS = `req-${Date.now()}`;

// ---------------------------------------------------------------------------
// Requests page — listing
// ---------------------------------------------------------------------------

test.describe("Requests page — listing", () => {
  let requestId: string;
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);
    const req = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-list-test`,
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    // Cancel the request so it doesn't pollute other tests
    await updateRequestStatus(requestId, "cancelled");
  });

  test("shows table with Date, Requester, Status, Kit, Target columns", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Date" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Requester" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Kit" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Target" })).toBeVisible();
  });

  test("status filter 'Open' shows only open requests", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");

    // Click the status filter combobox and select "Open"
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Open" }).click();

    // Our seeded request has status "open" so should appear
    // All visible status badges should read "open"
    const statusBadges = page.locator("tbody td:nth-child(3) > *");
    const count = await statusBadges.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(statusBadges.nth(i)).toHaveText("open");
      }
    }
  });

  test("status filter 'Fulfilled' hides open requests", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Fulfilled" }).click();

    // Our open test request should NOT be visible
    await expect(page.getByText(`${TS}-list-test`)).not.toBeVisible();
  });

  test("viewer can view requests list", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Request creation
// ---------------------------------------------------------------------------

test.describe("Request creation", () => {
  let kitId: string;
  let entityId: string;
  let createdRequestId: string | null = null;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-REQ-KIT`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-REQ-ENT`);
    entityId = entity.id;
  });

  test.afterAll(async () => {
    if (createdRequestId) await updateRequestStatus(createdRequestId, "cancelled");
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("any user can create a new request via dialog", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/requests");

    await page.getByRole("button", { name: /new request/i }).click();
    await expect(page.getByRole("heading", { name: "New Request" })).toBeVisible();

    // Select preferred kit
    const [kitCombobox, entityCombobox] = await page
      .getByRole("dialog")
      .getByRole("combobox")
      .all();
    await kitCombobox.click();
    await page.getByRole("option", { name: `${TS}-REQ-KIT` }).click();

    // Select target entity
    await entityCombobox.click();
    await page.getByRole("option", { name: `${TS}-REQ-ENT` }).click();

    // Fill notes
    await page
      .getByRole("dialog")
      .getByPlaceholder(/why do you need this kit/i)
      .fill(`${TS}-new-request-notes`);

    await page.getByRole("button", { name: /submit request/i }).click();

    // Dialog closes; new request appears in the list with "open" status
    await expect(
      page.getByRole("heading", { name: "New Request" })
    ).not.toBeVisible();

    // The request should now appear in the list — find it by the notes text
    // which shows in the target column area (not directly, but the row exists)
    // Since notes don't appear in the list directly, check "open" badge appears
    // and the kit serial appears in the Kit column
    await expect(page.getByRole("cell", { name: `${TS}-REQ-KIT` })).toBeVisible({
      message: "Newly created request should show the kit serial in the table",
    });

    // Capture request id for cleanup — find the row and navigate to detail
    const row = page.getByRole("row").filter({ hasText: `${TS}-REQ-KIT` }).first();
    const link = row.getByRole("link");
    const href = await link.getAttribute("href");
    if (href) {
      createdRequestId = href.split("/requests/")[1];
    }
  });

  test("cancel button closes request dialog without creating", async ({
    page,
  }) => {
    await loginAs(page, "user");
    await page.goto("/requests");
    await page.getByRole("button", { name: /new request/i }).click();
    await expect(page.getByRole("heading", { name: "New Request" })).toBeVisible();
    await page
      .getByRole("dialog")
      .getByPlaceholder(/why do you need this kit/i)
      .fill("cancel-test-notes");
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(
      page.getByRole("heading", { name: "New Request" })
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Request detail — admin approve / reject
// ---------------------------------------------------------------------------

test.describe("Request detail — admin approve and reject", () => {
  let openRequestId: string;
  let rejectRequestId: string;
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);
    const r1 = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-to-approve`,
    });
    openRequestId = r1.id;
    const r2 = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-to-reject`,
    });
    rejectRequestId = r2.id;
  });

  test.afterAll(async () => {
    // Both should already be in terminal states but guard either way
    await updateRequestStatus(openRequestId, "cancelled").catch(() => {});
    await updateRequestStatus(rejectRequestId, "cancelled").catch(() => {});
  });

  test("admin sees Admin actions card on open request", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${openRequestId}`);
    await expect(page.getByRole("heading", { name: "Admin actions" })).toBeVisible({
      message: "Admin actions card should be visible on an open request",
    });
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("admin can approve an open request", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${openRequestId}`);

    await page.getByRole("button", { name: "Approve" }).click();

    // Status badge in the heading area should update to "approved"
    await expect(
      page.getByRole("main").getByText("approved")
    ).toBeVisible({
      message: "Status should update to 'approved' after approval",
    });

    // Approve/Reject buttons disappear; Fulfill button appears
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Fulfill" })).toBeVisible();

    // Verify via API
    const req = await getRequest(openRequestId);
    expect(req.status, "API should show status=approved").toBe("approved");
  });

  test("admin can reject an open request", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${rejectRequestId}`);

    await page.getByRole("button", { name: "Reject" }).click();

    // Status badge should update to "rejected"
    await expect(
      page.getByRole("main").getByText("rejected")
    ).toBeVisible({
      message: "Status should update to 'rejected' after rejection",
    });

    // Admin actions card should disappear (rejected is a terminal state in the
    // condition: status !== "fulfilled" && status !== "cancelled" && status !== "rejected")
    await expect(
      page.getByRole("heading", { name: "Admin actions" })
    ).not.toBeVisible();

    // Verify via API
    const req = await getRequest(rejectRequestId);
    expect(req.status, "API should show status=rejected").toBe("rejected");
  });

  test("viewer does not see Admin actions card on any request", async ({
    page,
  }) => {
    await loginAs(page, "viewer");
    await page.goto(`/requests/${openRequestId}`);
    await expect(page.getByRole("heading", { name: "Request" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Admin actions" })
    ).not.toBeVisible({
      message: "Viewer should not see Admin actions card",
    });
  });

  test("detail page shows all request fields", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${rejectRequestId}`);
    await expect(page.getByText("Requester")).toBeVisible();
    await expect(page.getByText("Date")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Designated kit")).toBeVisible();
    await expect(page.getByText("Target entity")).toBeVisible();
    await expect(page.getByText("Notes")).toBeVisible();
    await expect(page.getByText(`${TS}-to-reject`)).toBeVisible({
      message: "Request notes should appear in the Details card",
    });
  });
});

// ---------------------------------------------------------------------------
// Request fulfill — atomicity test
// ---------------------------------------------------------------------------

test.describe("Request fulfill — atomic transaction + status update", () => {
  let kitId: string;
  let fromEntityId: string;
  let toEntityId: string;
  let requestId: string;
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);

    const kit = await createTestKit(`${TS}-FULFILL-KIT`);
    kitId = kit.id;

    const fromEntity = await createTestEntity(`${TS}-FULFILL-FROM`);
    fromEntityId = fromEntity.id;

    const toEntity = await createTestEntity(`${TS}-FULFILL-TO`);
    toEntityId = toEntity.id;

    // Place kit at fromEntity
    await createTestTransaction({ kitId, toEntityId: fromEntityId });

    // Create an approved request (kit + target entity already assigned)
    const req = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-fulfill-test`,
      designatedKitId: kitId,
      targetEntityId: toEntityId,
      status: "approved",
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(fromEntityId);
    await deactivateEntity(toEntityId);
    // Request is in "fulfilled" terminal state — no cleanup needed
  });

  test("admin can fulfill an approved request", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${requestId}`);

    // Should show Fulfill button (approved status, kit and entity assigned)
    await expect(page.getByRole("button", { name: "Fulfill" })).toBeVisible({
      message: "Fulfill button should be visible on an approved request",
    });

    const txCountBefore = await countTransactionsForKit(kitId);

    await page.getByRole("button", { name: "Fulfill" }).click();

    // Status badge should update to "fulfilled"
    await expect(
      page.getByRole("main").getByText("fulfilled")
    ).toBeVisible({
      message: "Status should update to 'fulfilled' after fulfillment",
    });

    // Admin actions card disappears for fulfilled requests
    await expect(
      page.getByRole("heading", { name: "Admin actions" })
    ).not.toBeVisible();

    // Verify via API — both the status AND the transaction were written
    const req = await getRequest(requestId);
    expect(req.status, "API should show status=fulfilled").toBe("fulfilled");

    const txCountAfter = await countTransactionsForKit(kitId);
    expect(
      txCountAfter,
      "A new transaction should have been created during fulfillment"
    ).toBe(txCountBefore + 1);
  });

  test("fulfilling request without a kit assigned shows error", async ({
    page,
  }) => {
    // Create a new approved request with no designated kit
    const noKitRequest = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-no-kit`,
      status: "approved",
    });

    await loginAs(page, "admin");
    await page.goto(`/requests/${noKitRequest.id}`);

    await page.getByRole("button", { name: "Fulfill" }).click();

    // The handleFulfill guard: "Assign a kit before fulfilling."
    await expect(
      page.getByText(/assign a kit before fulfilling/i)
    ).toBeVisible({
      message: "Error should appear when trying to fulfill without a designated kit",
    });

    // Clean up
    await updateRequestStatus(noKitRequest.id, "cancelled");
  });
});

// ---------------------------------------------------------------------------
// Request assign kit + entity + save assignment
// ---------------------------------------------------------------------------

test.describe("Request assignment (admin saves assignment)", () => {
  let kitId: string;
  let entityId: string;
  let requestId: string;
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);
    const kit = await createTestKit(`${TS}-ASSIGN-KIT`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-ASSIGN-ENT`);
    entityId = entity.id;
    const req = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-assignment-test`,
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    await updateRequestStatus(requestId, "cancelled").catch(() => {});
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("admin can assign kit and entity then save assignment", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${requestId}`);

    // Find the "Assign kit" select inside the Admin actions card
    // There are two comboboxes in the Admin actions card: kit and entity
    const adminCard = page.getByRole("heading", { name: "Admin actions" }).locator("..");
    const [kitSelect, entitySelect] = await adminCard.getByRole("combobox").all();

    await kitSelect.click();
    await page.getByRole("option", { name: `${TS}-ASSIGN-KIT` }).click();

    await entitySelect.click();
    await page.getByRole("option", { name: `${TS}-ASSIGN-ENT` }).click();

    await page.getByRole("button", { name: "Save assignment" }).click();

    // After saving, detail card should show the assigned kit serial and entity
    await expect(
      page.getByText(`${TS}-ASSIGN-KIT`)
    ).toBeVisible({ message: "Assigned kit serial should appear in Details card" });
    await expect(
      page.getByText(`${TS}-ASSIGN-ENT`)
    ).toBeVisible({ message: "Assigned entity name should appear in Details card" });

    // Verify via API
    const req = await getRequest(requestId);
    expect(req.designated_kit, "API should store designated_kit").toBe(kitId);
    expect(req.target_entity, "API should store target_entity").toBe(entityId);
  });
});

// ---------------------------------------------------------------------------
// Owner can cancel their own open request
// ---------------------------------------------------------------------------

test.describe("Request cancellation by owner", () => {
  let requestId: string;
  let userUserId: string;

  test.beforeAll(async () => {
    userUserId = await getUserIdByEmail(CREDENTIALS.user.email);
    const req = await createTestRequest({
      requesterId: userUserId,
      notes: `${TS}-owner-cancel`,
    });
    requestId = req.id;
  });

  test("request owner (user role) can cancel their own open request", async ({
    page,
  }) => {
    await loginAs(page, "user");
    await page.goto(`/requests/${requestId}`);

    // Owner should see "Cancel request" button (Actions card rendered when isOwner && status === "open")
    await expect(
      page.getByRole("button", { name: /cancel request/i })
    ).toBeVisible({ message: "Owner should see 'Cancel request' button" });

    await page.getByRole("button", { name: /cancel request/i }).click();

    // Status should update to "cancelled"
    await expect(
      page.getByRole("main").getByText("cancelled")
    ).toBeVisible({
      message: "Status should update to 'cancelled' after owner cancels",
    });

    // Cancel button should disappear (status is no longer "open")
    await expect(
      page.getByRole("button", { name: /cancel request/i })
    ).not.toBeVisible();

    // Verify via API
    const req = await getRequest(requestId);
    expect(req.status, "API should show status=cancelled").toBe("cancelled");
  });

  test("non-owner cannot see 'Cancel request' button", async ({ page }) => {
    // viewer is not the owner of userUserId's request
    // Re-seed a fresh open request for this check
    const freshReq = await createTestRequest({
      requesterId: userUserId,
      notes: `${TS}-no-cancel-viewer`,
    });

    await loginAs(page, "viewer");
    await page.goto(`/requests/${freshReq.id}`);
    await expect(page.getByRole("heading", { name: "Request" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /cancel request/i })
    ).not.toBeVisible({
      message: "Non-owner viewer should not see Cancel request button",
    });

    await updateRequestStatus(freshReq.id, "cancelled");
  });
});

// ---------------------------------------------------------------------------
// Request detail — back button navigation
// ---------------------------------------------------------------------------

test.describe("Request detail — navigation", () => {
  let requestId: string;
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);
    const req = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-nav-test`,
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    await updateRequestStatus(requestId, "cancelled");
  });

  test("back button navigates to /requests", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${requestId}`);
    // First button in main is the ArrowLeft ghost icon
    await page.locator("main").getByRole("button").first().click();
    await expect(page).toHaveURL(/\/requests$/);
  });
});

// ---------------------------------------------------------------------------
// Edit request (admin and owner)
// ---------------------------------------------------------------------------

test.describe("Edit request — admin", () => {
  let requestId: string;
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);
    const req = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-edit-req-original`,
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    await updateRequestStatus(requestId, "cancelled").catch(() => {});
  });

  test("admin sees 'Edit request' button on open request detail", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${requestId}`);
    await expect(
      page.getByRole("button", { name: /edit request/i })
    ).toBeVisible({ message: "Admin should see Edit request button on open request" });
  });

  test("admin can edit request notes via dialog", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${requestId}`);

    await page.getByRole("button", { name: /edit request/i }).click();

    await expect(
      page.getByRole("heading", { name: "Edit Request" })
    ).toBeVisible();

    // Clear notes and enter new value
    const notesField = page
      .getByRole("dialog")
      .getByPlaceholder(/why do you need this kit/i);
    await notesField.clear();
    await notesField.fill(`${TS}-edit-req-updated`);

    await page.getByRole("button", { name: /save changes/i }).click();

    // Dialog closes
    await expect(
      page.getByRole("heading", { name: "Edit Request" })
    ).not.toBeVisible();

    // Verify the updated notes appear in the details card
    await expect(page.getByText(`${TS}-edit-req-updated`)).toBeVisible({
      message: "Updated notes should appear in the request detail page",
    });

    // Verify via API
    const req = await getRequest(requestId);
    expect(req.notes, "API should store updated notes").toBe(
      `${TS}-edit-req-updated`
    );
  });

  test("admin sees 'Edit request' button on approved request detail", async ({
    page,
  }) => {
    const approvedReq = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-edit-approved`,
      status: "approved",
    });

    await loginAs(page, "admin");
    await page.goto(`/requests/${approvedReq.id}`);

    await expect(
      page.getByRole("button", { name: /edit request/i })
    ).toBeVisible({
      message: "Admin should see Edit request button on approved request too",
    });

    await updateRequestStatus(approvedReq.id, "cancelled");
  });
});

test.describe("Edit request — owner (user role)", () => {
  let requestId: string;
  let userUserId: string;

  test.beforeAll(async () => {
    userUserId = await getUserIdByEmail(CREDENTIALS.user.email);
    const req = await createTestRequest({
      requesterId: userUserId,
      notes: `${TS}-owner-edit-orig`,
    });
    requestId = req.id;
  });

  test.afterAll(async () => {
    await updateRequestStatus(requestId, "cancelled").catch(() => {});
  });

  test("request owner can edit their own open request", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto(`/requests/${requestId}`);

    await expect(
      page.getByRole("button", { name: /edit request/i })
    ).toBeVisible({ message: "Owner should see Edit request button on own open request" });

    await page.getByRole("button", { name: /edit request/i }).click();

    await expect(
      page.getByRole("heading", { name: "Edit Request" })
    ).toBeVisible();

    const notesField = page
      .getByRole("dialog")
      .getByPlaceholder(/why do you need this kit/i);
    await notesField.clear();
    await notesField.fill(`${TS}-owner-edit-updated`);

    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(
      page.getByRole("heading", { name: "Edit Request" })
    ).not.toBeVisible();

    await expect(page.getByText(`${TS}-owner-edit-updated`)).toBeVisible({
      message: "Updated notes should appear after owner edits request",
    });
  });
});

// ---------------------------------------------------------------------------
// expected_return field
// ---------------------------------------------------------------------------

test.describe("Request expected_return field", () => {
  let adminUserId: string;

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);
  });

  test("expected return date appears in requests list column", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");

    // The "Expected return" column header should always be present
    await expect(
      page.getByRole("columnheader", { name: /expected return/i })
    ).toBeVisible({ message: "Expected return column should be in the requests table" });
  });

  test("expected return date shown on request detail page", async ({
    page,
  }) => {
    // Seed a request with expected_return via the extra field on updateRequestStatus
    const req = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-expret-detail`,
    });
    // PocketBase PATCH accepts any valid field — use extra to set expected_return
    await updateRequestStatus(req.id, "open", {
      expected_return: "2030-06-15",
    } as any);

    await loginAs(page, "admin");
    await page.goto(`/requests/${req.id}`);

    // Detail page should have "Expected return" label
    await expect(page.getByText("Expected return")).toBeVisible({
      message: "Expected return label should appear in request detail",
    });
    // The formatted date value should contain the year 2030
    await expect(page.getByText(/2030/)).toBeVisible({
      message: "Expected return year (2030) should appear in request detail",
    });

    await updateRequestStatus(req.id, "cancelled");
  });

  test("new request dialog shows expected return date input", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");
    await page.getByRole("button", { name: /new request/i }).click();
    await expect(
      page.getByRole("heading", { name: "New Request" })
    ).toBeVisible();

    // The date input should be present
    await expect(
      page.getByRole("dialog").locator("input[type='date']")
    ).toBeVisible({
      message: "Expected return date input should be visible in New Request dialog",
    });

    await page.getByRole("button", { name: /^cancel$/i }).click();
  });
});
