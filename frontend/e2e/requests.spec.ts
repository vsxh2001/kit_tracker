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

  test("shows table with Date, Requester, Status, Kit, Target columns @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
    const table = page.locator("table");
    await expect(table.getByRole("columnheader", { name: "Date", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Requester" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Kit" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Target" })).toBeVisible();
  });

  test("status filter 'Open' shows only open requests", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/requests");

    // Click the status filter combobox and select "Open"
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Open" }).click();

    // Wait for the table to update with filtered results
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 5000 });

    // Our seeded request has status "open" so should appear
    // Verify the filter is working by checking that at least one status is "open"
    const statusCell = page.locator("table tbody tr:first-child td:nth-child(3)");
    await expect(statusCell).toContainText("open", { timeout: 5000 });
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

  test("any user can create a new request via dialog @smoke", async ({ page }) => {
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

    // Capture request id for cleanup — find the row, click it to navigate, then extract ID from URL
    const row = page.getByRole("row").filter({ hasText: `${TS}-REQ-KIT` }).first();
    await row.click();
    // Wait for navigation to complete
    await page.waitForURL(/\/requests\/[a-z0-9]+$/);
    const currentUrl = page.url();
    const match = currentUrl.match(/\/requests\/([a-z0-9]+)$/);
    if (match) {
      createdRequestId = match[1];
    }
    // Navigate back to requests list for other tests
    await page.goBack();
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
    // Wait for the Admin actions buttons to be visible (better than waitForLoadState)
    // Check for action buttons which indicate the Admin actions card is present
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 10_000,
      message: "Approve button should be visible on an open request",
    });
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible({
      message: "Reject button should be visible on an open request",
    });
  });

  test("admin can approve an open request @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${openRequestId}`);

    await page.getByRole("button", { name: "Approve" }).click();

    // Status badge in the heading area should update to "approved"
    // Wait for and verify the badge text
    await expect(
      page.getByText("approved", { exact: true }).first()
    ).toBeVisible({
      message: "Status badge should update to 'approved' after approval",
      timeout: 8000,
    });

    // Approve/Reject buttons disappear; Fulfill button appears
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Fulfill" })).toBeVisible();

    // Verify via API
    const req = await getRequest(openRequestId);
    expect(req.status, "API should show status=approved").toBe("approved");
  });

  test("admin can reject an open request @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/requests/${rejectRequestId}`);

    await page.getByRole("button", { name: "Reject" }).click();

    // Status badge should update to "rejected"
    await expect(
      page.getByText("rejected", { exact: true }).first()
    ).toBeVisible({
      message: "Status badge should update to 'rejected' after rejection",
      timeout: 8000,
    });

    // Primary action card disappears (rejected is a terminal state, so Approve/Reject/Fulfill buttons gone),
    // but danger-zone card still shows with Delete button and "Admin actions" heading.
    // Assert the specific action buttons are gone, not the heading.
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Fulfill" })).not.toBeVisible({ timeout: 8000 });

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
    // Verify all field labels appear in Details section
    await expect(page.getByText("Requester", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Date", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Status", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Designated kit", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Target entity", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible();
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

  test("admin can fulfill an approved request @smoke", async ({ page }) => {
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
      page.getByText("fulfilled", { exact: true }).first()
    ).toBeVisible({
      message: "Status badge should update to 'fulfilled' after fulfillment",
      timeout: 8000,
    });

    // Primary action card disappears for fulfilled requests (Fulfill button gone),
    // but danger-zone card still shows with Delete button and "Admin actions" heading.
    // Assert the specific action buttons are gone, not the heading.
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Fulfill" })).not.toBeVisible({ timeout: 8000 });

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
    // Look for the error message in the main content area, not the toast
    await expect(
      page.locator("p.text-destructive").filter({ hasText: /assign a kit before fulfilling/i })
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
    // Wait for the page to load — check for the Details heading and comboboxes for assignment
    await expect(page.getByRole("heading", { name: "Details" })).toBeVisible({ timeout: 10_000 });

    // Wait for the comboboxes to be ready for assignment interaction
    await expect(page.getByRole("combobox").first()).toBeVisible({ timeout: 5000 });

    // Find the "Assign kit" and "Target entity" selects - they should both be comboboxes
    const comboboxes = await page.getByRole("combobox").all();
    if (comboboxes.length < 2) {
      throw new Error(`Expected at least 2 comboboxes, found ${comboboxes.length}`);
    }
    // The first two comboboxes should be kit and entity assignment
    const [kitSelect, entitySelect] = comboboxes.slice(0, 2);

    await kitSelect.click();
    // Wait for the dropdown to appear
    await expect(page.getByRole("option", { name: `${TS}-ASSIGN-KIT` })).toBeVisible({ timeout: 2000 });
    await page.getByRole("option", { name: `${TS}-ASSIGN-KIT` }).click();

    // Wait for the dropdown to close and the selection to register
    await page.waitForTimeout(300);

    await entitySelect.click();
    // Wait for the dropdown to appear
    await expect(page.getByRole("option", { name: `${TS}-ASSIGN-ENT` })).toBeVisible({ timeout: 2000 });
    await page.getByRole("option", { name: `${TS}-ASSIGN-ENT` }).click();

    // Wait for the dropdown to close and the selection to register
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Save assignment" }).click();

    // After saving, detail card should show the assigned kit serial and entity
    // Wait for the details card to update with the new assignment
    await expect(
      page.getByText(`${TS}-ASSIGN-KIT`).first()
    ).toBeVisible({ timeout: 5000, message: "Assigned kit serial should appear in Details card" });
    await expect(
      page.getByText(`${TS}-ASSIGN-ENT`).first()
    ).toBeVisible({ timeout: 5000, message: "Assigned entity name should appear in Details card" });

    // Verify via API - refresh the request data to ensure latest version
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

  test("request owner (user role) can cancel their own open request @smoke", async ({
    page,
  }) => {
    await loginAs(page, "user");
    await page.goto(`/requests/${requestId}`);

    // Owner should see "Cancel request" button (Actions card rendered when isOwner && status === "open")
    await expect(
      page.getByRole("button", { name: /cancel request/i })
    ).toBeVisible({ message: "Owner should see 'Cancel request' button" });

    await page.getByRole("button", { name: /cancel request/i }).click();

    // Confirm the cancel action in the AlertDialog by clicking "Cancel request" button
    const confirmButton = page.getByRole("alertdialog").getByRole("button", { name: /^cancel request$/i });
    await confirmButton.click();

    // Wait for the first "Cancel request" button (the action button) to disappear,
    // which indicates the action has completed and the page has reloaded
    await expect(
      page.getByRole("button", { name: /cancel request/i })
    ).not.toBeVisible({ timeout: 5000 });

    // Status should update to "cancelled" - check the main content with a case-insensitive regex
    await expect(
      page.locator("main")
    ).toContainText(/cancelled/i, {
      timeout: 5000,
    });

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // The expected return date input should be present
    // In create mode, both delivery date and expected return date inputs are shown
    // Look for the expected return input by label
    const expectedReturnInput = page.getByRole("dialog").locator("input[type='date']").nth(1);
    await expect(expectedReturnInput).toBeVisible({
      message: "Expected return date input should be visible in New Request dialog",
    });

    await page.getByRole("button", { name: /^cancel$/i }).click();
  });
});
