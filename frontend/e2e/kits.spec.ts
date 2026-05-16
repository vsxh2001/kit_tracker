/**
 * Kit management flows.
 *
 * Coverage:
 *   - Kits page lists kits with Serial / Current entity / Last moved columns
 *   - Search/filter by serial (match and no-match)
 *   - Admin can create a new kit (KitFormDialog)
 *   - Empty serial shows validation error
 *   - Cancel button closes dialog without creating
 *   - Kit detail page shows serial, current location, transaction history
 *   - Admin sees Move kit / Edit / Delete buttons on detail page
 *   - Viewer sees no action buttons on kit detail
 *   - Admin can move a kit (MoveKitDialog creates a transaction)
 *   - Moving a kit updates the current entity shown
 *   - Move dialog requires selecting a destination
 *   - Admin can edit kit serial and notes
 *   - Admin can delete a kit via /kits row (soft-delete, removed from list)
 *   - Admin can delete a kit via /kits/:id detail header (redirects to /kits)
 *   - Viewer cannot see Delete button
 *   - Kit detail page does NOT show a Restore button
 *   - PATCH is_active=true via API still works (escape hatch)
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  createTestEntity,
  createTestTransaction,
  getLatestTransactionForKit,
  deleteKit,
  deactivateEntity,
  getKitBySerial,
  getAdminToken,
} from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// Unique prefix for all test data in this file — avoids collision across runs
const TS = `kits-${Date.now()}`;

// ---------------------------------------------------------------------------
// Kits page — listing and search
// ---------------------------------------------------------------------------

test.describe("Kits page — listing and search", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-SEARCH`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("shows table with Serial, Current entity, Last moved columns @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Serial" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Current entity" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Last moved" })).toBeVisible();
  });

  test("serial search filters results to matching kit", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await page.getByPlaceholder(/search by serial/i).fill(`${TS}-SEARCH`);
    await expect(page.getByRole("cell", { name: `${TS}-SEARCH` })).toBeVisible();
  });

  test("search with no match shows 'No kits found.'", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await page.getByPlaceholder(/search by serial/i).fill("ZZZZ-NONEXISTENT-9999");
    await expect(page.getByText(/no kits found/i)).toBeVisible();
  });

  test("viewer can view kits list @smoke", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Serial" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Kit creation (admin)
// ---------------------------------------------------------------------------

test.describe("Kit creation (admin)", () => {
  const SERIAL = `${TS}-CREATE`;

  test.afterAll(async () => {
    const kit = await getKitBySerial(SERIAL);
    if (kit) await deleteKit(kit.id);
  });

  test("admin can create a new kit via dialog @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await page.getByRole("button", { name: /new kit/i }).click();

    await expect(page.getByRole("heading", { name: "New Kit" })).toBeVisible();

    await page.getByLabel("Serial").fill(SERIAL);
    await page.getByLabel("Notes").fill("Created by Playwright test");

    await page.getByRole("button", { name: /^save$/i }).click();

    // Dialog closes and new serial appears in the table
    await expect(page.getByRole("heading", { name: "New Kit" })).not.toBeVisible();
    await expect(page.getByRole("cell", { name: SERIAL })).toBeVisible({
      message: "Newly created kit serial should appear in the table",
    });
  });

  test("creating a kit with empty serial shows validation error", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await page.getByRole("button", { name: /new kit/i }).click();
    await expect(page.getByRole("heading", { name: "New Kit" })).toBeVisible();
    // Do NOT fill serial — save immediately
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/serial is required/i)).toBeVisible({
      message: "Validation error for empty serial should appear",
    });
    // Dialog must stay open
    await expect(page.getByRole("heading", { name: "New Kit" })).toBeVisible();
  });

  test("cancel button closes dialog without creating kit", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await page.getByRole("button", { name: /new kit/i }).click();
    await expect(page.getByRole("heading", { name: "New Kit" })).toBeVisible();
    await page.getByLabel("Serial").fill("CANCELED-KIT-XYZ");
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByRole("heading", { name: "New Kit" })).not.toBeVisible();
    await expect(page.getByText("CANCELED-KIT-XYZ")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Kit detail page
// ---------------------------------------------------------------------------

test.describe("Kit detail page", () => {
  let kitId: string;
  let entityId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-DETAIL`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS}-Entity`);
    entityId = entity.id;
    await createTestTransaction({ kitId, toEntityId: entityId });
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("shows serial, current location, and transaction history", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    // Serial is in the page heading (h1)
    await expect(page.getByRole("heading", { name: `${TS}-DETAIL` })).toBeVisible({
      message: "Serial should appear in the heading",
    });
    // Current location section
    await expect(page.getByText("Current location")).toBeVisible();
    // The current entity name appears in the Details card (first occurrence)
    await expect(page.getByText(`${TS}-Entity`).first()).toBeVisible({
      message: "Current entity name should appear in the Details card",
    });
    // Transaction history section
    await expect(
      page.getByRole("heading", { name: "Transaction history" })
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "To" })).toBeVisible();
  });

  test("admin sees Move kit, Edit, and Delete buttons", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: /move kit/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^deactivate$/i })).toBeVisible();
  });

  test("viewer does not see action buttons on kit detail", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto(`/kits/${kitId}`);
    await expect(
      page.getByRole("heading", { name: `${TS}-DETAIL` })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /move kit/i })
    ).not.toBeVisible({ message: "Viewer should not see Move kit" });
    await expect(
      page.getByRole("button", { name: /^delete$/i })
    ).not.toBeVisible({ message: "Viewer should not see Delete" });
    await expect(
      page.getByRole("button", { name: /^edit$/i })
    ).not.toBeVisible({ message: "Viewer should not see Edit" });
  });

  test("back button navigates to /kits", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    // The ArrowLeft ghost-icon button navigates back; it has no text label.
    // The first button in the page is always the back arrow.
    await page.locator("main").getByRole("button").first().click();
    await expect(page).toHaveURL(/\/kits$/);
  });
});

// ---------------------------------------------------------------------------
// Kit move (transfer)
// ---------------------------------------------------------------------------

test.describe("Kit move (transfer)", () => {
  let kitId: string;
  let fromEntityId: string;
  let toEntityId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-MOVE`);
    kitId = kit.id;
    const from = await createTestEntity(`${TS}-FromEnt`);
    fromEntityId = from.id;
    const to = await createTestEntity(`${TS}-ToEnt`);
    toEntityId = to.id;
    // Place kit at fromEntity first
    await createTestTransaction({ kitId, toEntityId: fromEntityId });
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(fromEntityId);
    await deactivateEntity(toEntityId);
  });

  test("admin can move kit to another entity", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Starting location shown in detail card
    // The starting location entity name appears in the Details card (first occurrence)
    await expect(page.getByText(`${TS}-FromEnt`).first()).toBeVisible();

    // Open move dialog
    await page.getByRole("button", { name: /move kit/i }).click();

    // Dialog title includes kit serial — use partial match
    await expect(
      page.getByRole("dialog", { name: /move kit/i })
    ).toBeVisible();

    // Current location is shown inside the dialog
    await expect(page.getByRole("dialog").getByText(`${TS}-FromEnt`)).toBeVisible();

    // Select destination entity via the combobox
    await page.getByRole("dialog").getByRole("combobox").click();
    await page.getByRole("option", { name: `${TS}-ToEnt` }).click();

    // Submit
    await page.getByRole("button", { name: /^move kit$/i }).click();

    // Dialog should close
    await expect(page.getByRole("dialog", { name: /move kit/i })).not.toBeVisible();

    // New entity shown as current location on the detail page
    await expect(page.getByText(`${TS}-ToEnt`).first()).toBeVisible({
      message: "New entity should be displayed as current location after move",
    });
  });

  test("move kit creates a new transaction — verified via API", async () => {
    // Verify the transaction record was written to PocketBase
    const tx = await getLatestTransactionForKit(kitId);
    expect(tx, "A transaction should exist for the kit").not.toBeNull();
    expect(tx!.to_entity, "Transaction to_entity should be the destination").toBe(
      toEntityId
    );
  });

  test("move dialog shows error when no destination is selected", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await page.getByRole("button", { name: /move kit/i }).click();
    await expect(page.getByRole("dialog", { name: /move kit/i })).toBeVisible();

    // Click submit without selecting a destination
    await page.getByRole("button", { name: /^move kit$/i }).click();

    await expect(
      page.getByText(/select destination entity/i)
    ).toBeVisible({
      message: "Error message should appear when no destination is selected",
    });
    // Dialog stays open
    await expect(page.getByRole("dialog", { name: /move kit/i })).toBeVisible();
  });

  test("cancel button closes move dialog without creating transaction", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await page.getByRole("button", { name: /move kit/i }).click();
    await expect(page.getByRole("dialog", { name: /move kit/i })).toBeVisible();
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByRole("dialog", { name: /move kit/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Kit edit
// ---------------------------------------------------------------------------

test.describe("Kit edit", () => {
  const ORIG_SERIAL = `${TS}-EDIT-ORIG`;
  const NEW_SERIAL = `${TS}-EDIT-NEW`;
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(ORIG_SERIAL, "original notes");
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    // Clean up the new serial name too in case it was saved
    const kit = await getKitBySerial(NEW_SERIAL);
    if (kit) await deleteKit(kit.id);
  });

  test("admin can edit kit serial and notes", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await page.getByRole("button", { name: /^edit$/i }).click();

    await expect(page.getByRole("heading", { name: "Edit Kit" })).toBeVisible();

    await page.getByLabel("Serial").clear();
    await page.getByLabel("Serial").fill(NEW_SERIAL);
    await page.getByLabel("Notes").clear();
    await page.getByLabel("Notes").fill("updated notes by test");

    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(
      page.getByRole("heading", { name: "Edit Kit" })
    ).not.toBeVisible();
    await expect(page.getByRole("heading", { name: NEW_SERIAL })).toBeVisible({
      message: "Updated serial should appear in the page heading",
    });
  });
});

// ---------------------------------------------------------------------------
// Kit delete — via /kits/:id detail page
// ---------------------------------------------------------------------------

test.describe("Kit delete via detail page", () => {
  const DELETE_SERIAL = `${TS}-DEL-DETAIL`;
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(DELETE_SERIAL);
    kitId = kit.id;
  });

  // No afterAll cleanup — deleting sets is_active=false (same as deleteKit soft-delete).

  test("admin can delete a kit via detail page @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    await page.getByRole("button", { name: /^deactivate$/i }).click();

    // AlertDialog should appear
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("alertdialog").getByText(/deactivate kit/i)).toBeVisible();

    // Confirm
    await page.getByRole("alertdialog").getByRole("button", { name: /^deactivate$/i }).click();

    // Redirects to /kits
    await page.waitForURL("**/kits", { timeout: 5000 });

    // Deleted kit should not appear in active list
    await page.getByPlaceholder(/search by serial/i).fill(DELETE_SERIAL);
    await expect(page.getByText(/no kits found/i)).toBeVisible({
      timeout: 5000,
      message: "Deleted kit should not appear in active list",
    });
  });

  test("kit detail page does not show a Restore button", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: /restore/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /reactivate/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Kit delete — via /kits row action
// ---------------------------------------------------------------------------

test.describe("Kit delete via kits list row", () => {
  const DELETE_ROW_SERIAL = `${TS}-DEL-ROW`;

  test.beforeAll(async () => {
    await createTestKit(DELETE_ROW_SERIAL);
  });

  test("admin can delete a kit via row Delete button", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");

    // Filter to find the specific kit row
    await page.getByPlaceholder(/search by serial/i).fill(DELETE_ROW_SERIAL);
    await expect(page.getByRole("cell", { name: DELETE_ROW_SERIAL })).toBeVisible();

    // Click the Deactivate button in that row
    await page.getByRole("button", { name: /^deactivate$/i }).first().click();

    // AlertDialog appears
    await expect(page.getByRole("alertdialog")).toBeVisible();

    // Confirm
    await page.getByRole("alertdialog").getByRole("button", { name: /^deactivate$/i }).click();

    // Kit row disappears from the list
    await expect(page.getByRole("cell", { name: DELETE_ROW_SERIAL })).not.toBeVisible({
      timeout: 5000,
      message: "Deleted kit should be removed from the list",
    });
  });
});

// ---------------------------------------------------------------------------
// Kit delete — viewer cannot see Delete button
// ---------------------------------------------------------------------------

test.describe("Kit delete — viewer access", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-DEL-VIEW`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("viewer cannot see Delete button on detail page", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: /^delete$/i })).not.toBeVisible({
      message: "Viewer should not see Delete button",
    });
  });
});

// ---------------------------------------------------------------------------
// Kit delete — API escape hatch (PATCH is_active=true still works)
// ---------------------------------------------------------------------------

test.describe("Kit delete — API escape hatch", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-DEL-ESCAPE`);
    kitId = kit.id;
    // Soft-delete it via API
    await deleteKit(kitId);
  });

  test("PATCH is_active=true via API reactivates the kit", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/collections/kits/records/${kitId}`, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.is_active).toBe(true);
    // Cleanup
    await deleteKit(kitId);
  });
});
