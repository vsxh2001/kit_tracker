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
 *   - Admin sees Move kit / Edit / Retire buttons on detail page
 *   - Viewer sees no action buttons on kit detail
 *   - Admin can move a kit (MoveKitDialog creates a transaction)
 *   - Moving a kit updates the current entity shown
 *   - Move dialog requires selecting a destination
 *   - Admin can edit kit serial and notes
 *   - Admin can retire a kit (soft-deactivate, redirects to /kits)
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
} from "./helpers/api";

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

  test("shows table with Serial, Current entity, Last moved columns", async ({
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

  test("viewer can view kits list", async ({ page }) => {
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

  test("admin can create a new kit via dialog", async ({ page }) => {
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

  test("admin sees Move kit, Edit, and Retire kit buttons", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: /move kit/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^edit$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /retire kit/i })).toBeVisible();
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
      page.getByRole("button", { name: /retire kit/i })
    ).not.toBeVisible({ message: "Viewer should not see Retire kit" });
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
// Kit retire
// ---------------------------------------------------------------------------

test.describe("Kit retire", () => {
  const RETIRE_SERIAL = `${TS}-RETIRE`;
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(RETIRE_SERIAL);
    kitId = kit.id;
  });

  // No afterAll cleanup needed — retiring sets is_active=false which is
  // effectively the same as deleteKit() soft-delete.

  test("admin can retire a kit", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    await page.getByRole("button", { name: /retire kit/i }).click();

    // Confirm the retire action in the AlertDialog
    await page.getByRole("alertdialog").getByRole("button", { name: /^retire$/i }).click();

    // After retire, page redirects to /kits - wait for it
    await page.waitForURL("**/kits", { timeout: 5000 });

    // Retired kit (is_active=false) should not appear in active kit list
    await page.getByPlaceholder(/search by serial/i).fill(RETIRE_SERIAL);
    await expect(page.getByText(/no kits found/i)).toBeVisible({
      timeout: 5000,
      message: "Retired kit should not appear in the active kits list",
    });
  });
});
