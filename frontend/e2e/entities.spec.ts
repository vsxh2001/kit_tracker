/**
 * Entity management flows.
 *
 * Coverage:
 *   - Entities page lists entities (including inactive) with Name/Description/Active columns
 *   - Admin sees Edit and Deactivate buttons per active row
 *   - Viewer sees no action buttons
 *   - Admin can create a new entity via EntityFormDialog
 *   - Empty name shows validation error; dialog stays open
 *   - Cancel button closes dialog without creating
 *   - Admin can edit entity name and description
 *   - Admin can deactivate an entity (confirm dialog → is_active=false)
 *   - Deactivated entity shows "No" in the Active column; no Deactivate button
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestEntity,
  deactivateEntity,
  deleteEntityRecord,
  getEntityByName,
  getAdminToken,
  createTestKit,
  deleteKit,
  createTestTransaction,
} from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

const TS = `ent-${Date.now()}`;

// ---------------------------------------------------------------------------
// Entities page — listing
// ---------------------------------------------------------------------------

test.describe("Entities page — listing", () => {
  let entityId: string;

  test.beforeAll(async () => {
    const e = await createTestEntity(`${TS}-LIST`, "list test description");
    entityId = e.id;
  });

  test.afterAll(async () => {
    await deactivateEntity(entityId);
  });

  test("shows table with Name, Description, Active columns @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Description" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Active" })).toBeVisible();
  });

  test("new entity appears in list with correct description", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    const nameCell = page.getByRole("cell", { name: `${TS}-LIST` });
    await expect(nameCell).toBeVisible();
    // Check that the row contains the description
    const row = nameCell.locator("..");
    await expect(row.getByText("list test description")).toBeVisible();
  });

  test("admin sees Edit and Deactivate buttons on active entity rows", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    // There should be at least one Edit button visible
    await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible({
      message: "Admin should see Edit buttons on entity rows",
    });
    await expect(
      page.getByRole("button", { name: "Deactivate" }).first()
    ).toBeVisible({
      message: "Admin should see Deactivate buttons on active entity rows",
    });
  });

  test("viewer sees no Edit or Deactivate buttons @smoke", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).not.toBeVisible({
      message: "Viewer should not see Edit buttons",
    });
    await expect(
      page.getByRole("button", { name: "Deactivate" })
    ).not.toBeVisible({ message: "Viewer should not see Deactivate buttons" });
  });
});

// ---------------------------------------------------------------------------
// Entity creation (admin)
// ---------------------------------------------------------------------------

test.describe("Entity creation (admin)", () => {
  const ENTITY_NAME = `${TS}-CREATE`;

  test.afterAll(async () => {
    const e = await getEntityByName(ENTITY_NAME);
    if (e) await deactivateEntity(e.id);
  });

  test("admin can create a new entity via dialog @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await page.getByRole("button", { name: /new entity/i }).click();

    await expect(page.getByRole("heading", { name: "New Entity" })).toBeVisible();

    // EntityFormDialog uses plain <Label> components (not htmlFor-linked)
    // getByLabel works because Radix Label wraps the input element
    await page.getByLabel("Name").fill(ENTITY_NAME);

    // Select category (required field — absence caused the prod-breaking 400)
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Storage" }).click();

    await page.getByLabel("Description").fill("Created by Playwright");

    await page.getByRole("button", { name: /^save$/i }).click();

    // Dialog closes and entity appears in the list
    await expect(
      page.getByRole("heading", { name: "New Entity" })
    ).not.toBeVisible();
    await expect(page.locator("table tbody").getByRole("cell", { name: ENTITY_NAME, exact: true })).toBeVisible({
      message: "Newly created entity should appear in the table",
    });
  });

  test("creating with empty name shows validation error", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await page.getByRole("button", { name: /new entity/i }).click();
    await expect(page.getByRole("heading", { name: "New Entity" })).toBeVisible();
    // Do NOT fill name
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/name is required/i)).toBeVisible({
      message: "Validation error for empty name should appear",
    });
    // Dialog must stay open
    await expect(page.getByRole("heading", { name: "New Entity" })).toBeVisible();
  });

  test("cancel button closes dialog without creating entity", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await page.getByRole("button", { name: /new entity/i }).click();
    await expect(page.getByRole("heading", { name: "New Entity" })).toBeVisible();
    await page.getByLabel("Name").fill("CANCELED-ENT-XYZ");
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(
      page.getByRole("heading", { name: "New Entity" })
    ).not.toBeVisible();
    await expect(page.getByText("CANCELED-ENT-XYZ")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Entity edit (admin)
// ---------------------------------------------------------------------------

test.describe("Entity edit (admin)", () => {
  const ORIG_NAME = `${TS}-EDIT-ORIG`;
  const NEW_NAME = `${TS}-EDIT-NEW`;
  let entityId: string;

  test.beforeAll(async () => {
    const e = await createTestEntity(ORIG_NAME, "original description");
    entityId = e.id;
  });

  test.afterAll(async () => {
    await deactivateEntity(entityId);
    const e = await getEntityByName(NEW_NAME);
    if (e) await deactivateEntity(e.id);
  });

  test("admin can edit entity name and description", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");

    // Find and click the Edit button on the ORIG_NAME row
    const row = page.getByRole("row", { name: new RegExp(ORIG_NAME) });
    await row.getByRole("button", { name: "Edit" }).click();

    await expect(page.getByRole("heading", { name: "Edit Entity" })).toBeVisible();

    await page.getByLabel("Name").clear();
    await page.getByLabel("Name").fill(NEW_NAME);
    await page.getByLabel("Description").clear();
    await page.getByLabel("Description").fill("updated description by test");

    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(
      page.getByRole("heading", { name: "Edit Entity" })
    ).not.toBeVisible();
    await expect(page.getByRole("cell", { name: NEW_NAME })).toBeVisible({
      message: "Updated entity name should appear in the table",
    });
  });
});

// ---------------------------------------------------------------------------
// Entity deactivate (admin)
// ---------------------------------------------------------------------------

test.describe("Entity deactivate (admin)", () => {
  const DEACT_NAME = `${TS}-DEACT`;
  test.beforeAll(async () => {
    await createTestEntity(DEACT_NAME, "to be deactivated");
  });

  // No afterAll needed — the test itself deactivates the entity

  test("admin can deactivate an entity", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");

    // Find the row for the entity to deactivate
    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");
    const entityRow = rows.filter({ hasText: DEACT_NAME }).first();

    // Click Deactivate button
    await entityRow.getByRole("button", { name: "Deactivate" }).click();

    // Confirm the AlertDialog
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();

    // After deactivation, wait for the page to reload and check the Active column
    await expect(entityRow.getByText("No")).toBeVisible({
      timeout: 5000,
      message: "Active column should show 'No' after deactivation",
    });

    // Deactivate button should be gone
    await expect(
      entityRow.getByRole("button", { name: "Deactivate" })
    ).not.toBeVisible({ message: "Deactivate button should disappear after deactivation" });
  });
});

// ---------------------------------------------------------------------------
// Entity delete (admin)
// ---------------------------------------------------------------------------

test.describe("Entity delete (admin)", () => {
  const DEL_NAME = `${TS}-DEL`;
  let entityId: string;

  test.beforeAll(async () => {
    const e = await createTestEntity(DEL_NAME, "to be deleted");
    entityId = e.id;
  });

  test.afterAll(async () => {
    // Best-effort cleanup in case the delete test didn't run
    await deleteEntityRecord(entityId).catch(() => {});
  });

  test("admin sees Delete button on every entity row", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await expect(
      page.getByRole("button", { name: "Delete" }).first()
    ).toBeVisible({ message: "Admin should see Delete buttons on entity rows" });
  });

  test("viewer does not see Delete button", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).not.toBeVisible({
      message: "Viewer should not see Delete buttons",
    });
  });

  test("admin can delete an entity (it disappears from the list)", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");

    // Confirm the entity exists in the list first
    await expect(page.getByRole("cell", { name: DEL_NAME })).toBeVisible();

    // Accept the browser confirm dialog for the Delete action
    page.once("dialog", (dialog) => dialog.accept());

    const row = page.getByRole("row", { name: new RegExp(DEL_NAME) });
    await row.getByRole("button", { name: "Delete" }).click();

    // After deletion the row should disappear
    await expect(page.getByRole("cell", { name: DEL_NAME })).not.toBeVisible({
      message: "Deleted entity should no longer appear in the table",
    });
  });
});

// ---------------------------------------------------------------------------
// Category required — API regression
// ---------------------------------------------------------------------------

test.describe("Entity category — schema enforcement", () => {
  test("create entity without category is rejected by PB", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `NoCat-${Date.now()}`, is_active: true, type: "other" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body?.data?.category?.code).toBe("validation_required");
  });
});

// ---------------------------------------------------------------------------
// Entity snapshot (time-machine)
// ---------------------------------------------------------------------------

test.describe("Entity snapshot — time-machine @smoke", () => {
  const SNAP_ENTITY = `${TS}-SNAP-ENT`;
  const SNAP_KIT = `SNAP-KIT-${Date.now()}`;
  let entityId: string;
  let kitId: string;
  let txId: string;

  test.beforeAll(async () => {
    const e = await createTestEntity(SNAP_ENTITY, "snapshot test entity");
    entityId = e.id;
    const k = await createTestKit(SNAP_KIT, "snapshot kit notes");
    kitId = k.id;
    const tx = await createTestTransaction({ kitId, toEntityId: entityId });
    txId = tx.id;
  });

  test.afterAll(async () => {
    // soft-delete kit (transaction references it — cannot hard-delete)
    await deleteKit(kitId);
    await deactivateEntity(entityId);
    void txId; // referenced for typing only
  });

  test("admin opens entity, clicks Snapshot, picks today, sees kit in table @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/entities/${entityId}`);

    // Snapshot button must be visible
    await expect(page.getByRole("button", { name: /snapshot/i })).toBeVisible();
    await page.getByRole("button", { name: /snapshot/i }).click();

    // Dialog opens with title
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: /Snapshot —/ })
    ).toBeVisible();

    // Explicitly set today's date in local TZ (YYYY-MM-DD) to avoid TZ skew
    const todayStr = new Date().toLocaleDateString("en-CA");
    await page.getByRole("dialog").getByLabel("Snapshot date").fill(todayStr);

    // The Show button triggers fetch (dialog auto-loads on open with today's date)
    // Wait for loading to finish and kit serial to appear
    await expect(
      page
        .getByRole("dialog")
        .locator("table")
        .getByRole("cell", { name: SNAP_KIT, exact: true })
        .first()
    ).toBeVisible({ timeout: 10000 });
  });
});
