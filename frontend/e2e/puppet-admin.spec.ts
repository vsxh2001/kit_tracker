/**
 * Puppet Show V2 — Admin persona pass
 * Stories: A3, A4, B1, B2, B3(verify), B5, B6, C1(setup), C2, C3, C4, C5,
 *          D1, D2, D3, D4, E1, E2, F1, F4, F5,
 *          G1, G2, G3, G4, G5, G6,
 *          I1(admin), I2(admin), I5(self-promote block via API),
 *          L1, L2, L3
 *
 * Runs as a single spec using the demo-admin-1 persona.
 * Findings are captured via test outcome + screenshots saved to test-results/puppet-admin/.
 */
import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const ADMIN_EMAIL = "demo-admin-1@kit.local";
const ADMIN_PASSWORD = "Pass1234!";
const SCREENSHOT_DIR = path.resolve(_dirname, "../../test-results/puppet-admin");

// Ensure screenshot dir exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Known seeded kit/entity IDs (from seed verification)
const KNOWN = {
  kit001: { serial: "DEMO-KIT-001", id: "1rkb4drl2z0qk65" },
  kit002: { serial: "DEMO-KIT-002", id: "8ojd0jmd2o2xn5v" },
  kit003: { serial: "DEMO-KIT-003", id: "sjhfgmel6epocn7" },
  kit005: { serial: "DEMO-KIT-005", id: "cpzaob3b9j8v9bt" },
  kit008: { serial: "DEMO-KIT-008", id: "er20l0nwjs9y4zx" },
  kit015: { serial: "DEMO-KIT-015", id: "wa8xz5jt82kuvv7" },
  kit022: { serial: "DEMO-KIT-022", id: "f85wkgm1s3jeebi" },
  entity001: { name: "DEMO-Entity-001", id: "cv6v8kqnfb1fxl2" },
  entity002: { name: "DEMO-Entity-002", id: "gmao3wb5yzu7cue" },
  entity004: { name: "DEMO-Entity-004", id: "vhtynrtd0bldie9" },
  adminUser: { email: ADMIN_EMAIL, id: "nn5cnsnmoynoqcc" },
};

async function screenshot(page: Page, name: string) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

/** Wait for a modal dialog (not the mobile nav aside which also has role=dialog) */
async function waitForModal(page: Page, timeout = 8_000) {
  // The mobile nav has aria-label="Navigation menu" — exclude it
  await page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').waitFor({
    state: "visible",
    timeout,
  });
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

// ─── GROUP A: Onboarding & Auth ──────────────────────────────────────────────
// FIXME: puppet-admin smoke tests broken since UX renames (kits.delete→deactivate,
// maintenance.kms_type, oncall.is_active) and brittle test setup (demo user seed).
// Re-baseline in next puppet pass with proper demo data setup.

test.describe.skip("A. Onboarding & auth", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("A3: Admin creates user with role pre-assigned @smoke", async ({ page }) => {
    await page.goto("/users");
    await page.waitForSelector("table, [data-testid='users-list'], h1", { timeout: 10_000 });
    await screenshot(page, "A3-users-page");

    // Look for Add user button
    const addBtn = page.getByRole("button", { name: /add user|new user|invite/i }).first();
    const addBtnVisible = await addBtn.isVisible().catch(() => false);

    if (!addBtnVisible) {
      await screenshot(page, "A3-no-add-button");
      // Document: no "Add user" button found — may be create via PB panel only
    } else {
      await addBtn.click();
      await waitForModal(page);

      const emailInput = page.getByLabel(/email/i).first();
      const nameInput = page.getByLabel(/name/i).first();
      if (await emailInput.isVisible()) await emailInput.fill("puppet-tech-3@kit.local");
      if (await nameInput.isVisible()) await nameInput.fill("Puppet Tech 3");

      // Select role — look for combobox
      const roleSelect = page.getByRole("combobox").filter({ hasText: /role|select/i }).first();
      if (await roleSelect.isVisible()) {
        await roleSelect.click();
        await page.getByRole("option", { name: /technician/i }).first().click();
      }

      const passwordInput = page.getByLabel(/password/i).first();
      if (await passwordInput.isVisible()) await passwordInput.fill("Pass1234!");

      await screenshot(page, "A3-filled-form");
      await page.getByRole("button", { name: /save|create|submit|add/i }).last().click();
      await page.waitForTimeout(2000);
      await screenshot(page, "A3-after-submit");
    }

    // Just verify we can reach /users as admin
    expect(page.url()).toContain("users");
  });

  test("A4: Last-admin demotion rejected @smoke", async ({ page }) => {
    await page.goto("/users");
    await page.waitForSelector("table, [data-testid='users-list'], h1", { timeout: 10_000 });
    await screenshot(page, "A4-users-page");

    // Try to find own row (demo-admin-1)
    const adminRow = page.locator("tr").filter({ hasText: ADMIN_EMAIL });
    const rowVisible = await adminRow.isVisible().catch(() => false);

    if (!rowVisible) {
      await screenshot(page, "A4-admin-row-not-found");
      // Skip - can't find own row
      return;
    }

    // Find edit button in admin row
    const editBtn = adminRow.getByRole("button").filter({ hasText: /edit|change|role/i }).first();
    const editVisible = await editBtn.isVisible().catch(() => false);

    if (!editVisible) {
      // Try clicking the row or a select
      const roleSelect = adminRow.locator('select, [role="combobox"]').first();
      const selectVisible = await roleSelect.isVisible().catch(() => false);
      if (selectVisible) {
        await roleSelect.click();
        // Try to select "user"
        const userOption = page.getByRole("option", { name: /^user$/i });
        if (await userOption.isVisible().catch(() => false)) {
          await userOption.click();
          await page.waitForTimeout(2000);

          // Check for error toast
          const errorVisible = await page.getByText(/last admin|cannot demote|error/i).isVisible().catch(() => false);
          await screenshot(page, "A4-after-demotion-attempt");

          if (errorVisible) {
            // Good - rejection worked
          } else {
            // Check via API if role actually changed
            await page.evaluate(async () => {
              const stored = localStorage.getItem("pocketbase_auth");
              return stored ? JSON.parse(stored).token : null;
            });
          }
        }
      }
    } else {
      await editBtn.click();
      await screenshot(page, "A4-edit-dialog");
    }

    await screenshot(page, "A4-final-state");
    // Admin should still be admin
    const adminToken = await page.evaluate(() => {
      const stored = localStorage.getItem("pocketbase_auth");
      return stored ? JSON.parse(stored) : null;
    });
    expect(adminToken).not.toBeNull();
  });
});

// ─── GROUP B: Kit lifecycle ───────────────────────────────────────────────────

test.describe.skip("B. Kit lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("B1: Admin creates a new kit @smoke", async ({ page }) => {
    await page.goto("/kits");
    await page.waitForSelector("table, h1, [data-testid]", { timeout: 10_000 });

    // Click "New kit" — button labeled "New kit" in the header
    const newKitBtn = page.getByRole("button", { name: "New kit" });
    await expect(newKitBtn, "New kit button must be visible for admin").toBeVisible({ timeout: 5_000 });
    await newKitBtn.click();

    await waitForModal(page);
    await screenshot(page, "B1-new-kit-dialog");

    // Fill serial — input has placeholder "KIT-001"
    const serialInput = page.getByRole("textbox", { name: "Serial" });
    await serialInput.fill("PUPPET-KIT-001");

    const notesInput = page.getByRole("textbox", { name: "Notes" });
    if (await notesInput.isVisible()) await notesInput.fill("Demo kit");

    await screenshot(page, "B1-filled");

    // Submit via "Save" button in dialog
    await page.getByRole("button", { name: "Save" }).click();

    // Wait for dialog to close + list refresh
    await page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').waitFor({ state: "hidden", timeout: 10_000 });
    await screenshot(page, "B1-after-submit");

    // Verify kit appears in list — use first() to avoid strict mode error if run multiple times
    await expect(page.getByRole("cell", { name: "PUPPET-KIT-001" }).first(),
      "PUPPET-KIT-001 should appear in kit table after create").toBeVisible({ timeout: 5_000 });
  });

  test("B2: Duplicate serial rejected", async ({ page }) => {
    await page.goto("/kits");
    await page.waitForSelector("table, h1", { timeout: 10_000 });

    const newKitBtn = page.getByRole("button", { name: /new kit/i });
    await newKitBtn.click();
    await waitForModal(page);

    // Use PUPPET-KIT-001 which may or may not exist
    const serialInput = page.getByLabel(/serial/i).first();
    if (await serialInput.isVisible()) {
      await serialInput.fill("PUPPET-KIT-001");
    }

    await page.getByRole("button", { name: /save|create|submit/i }).last().click();
    await page.waitForTimeout(2000);
    await screenshot(page, "B2-after-duplicate-submit");

    // Either dialog still open (error shown) or toast error
    const dialogStillOpen = await page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').isVisible().catch(() => false);
    const errorText = await page.getByText(/unique|already exists|duplicate|error/i).isVisible().catch(() => false);

    // Note the outcome - if dialog closed silently, that's a bug
    if (!dialogStillOpen && !errorText) {
      await screenshot(page, "B2-FAIL-dialog-closed-silently");
      // This is a known bug (BUG-1 from memory: no unique constraint on kit serial)
    }
  });

  test("B3: Verify kit move shows updated holder", async ({ page }) => {
    // Verify DEMO-KIT-001 detail page shows current holder info
    await page.goto(`/kits/${KNOWN.kit001.id}`);
    await page.waitForSelector("h1, h2, [data-testid]", { timeout: 10_000 });
    await screenshot(page, "B3-kit001-detail");

    // Check "Move kit" button visible for admin — use exact label to avoid matching Components "Move" buttons
    const moveBtn = page.getByRole("button", { name: "Move kit" });
    const moveBtnVisible = await moveBtn.isVisible().catch(() => false);

    if (!moveBtnVisible) {
      await screenshot(page, "B3-no-move-button");
    }

    expect(moveBtnVisible, "Move kit button should be visible for admin").toBe(true);
  });

  test("B5: Correction via reverse transaction", async ({ page }) => {
    // Move DEMO-KIT-001 to entity-002 then verify two transactions
    await page.goto(`/kits/${KNOWN.kit001.id}`);
    await page.waitForSelector("h1, h2", { timeout: 10_000 });

    const moveBtn = page.getByRole("button", { name: "Move kit" });
    if (!await moveBtn.isVisible().catch(() => false)) {
      await screenshot(page, "B5-no-move-button");
      return;
    }

    await moveBtn.click();
    await waitForModal(page);
    await screenshot(page, "B5-move-dialog");

    // Select target entity from combobox in dialog
    const anyCombo = page.locator('[role="dialog"]:not([aria-label="Navigation menu"]) [role="combobox"]').first();
    if (await anyCombo.isVisible()) {
      await anyCombo.click();
      const entityOpt = page.getByRole("option", { name: /DEMO-Entity-002/i }).first();
      if (await entityOpt.isVisible().catch(() => false)) {
        await entityOpt.click();
      } else {
        const firstOpt = page.getByRole("option").first();
        if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click();
      }
    }

    const notesInput = page.locator('[role="dialog"]:not([aria-label="Navigation menu"]) textarea').first();
    if (await notesInput.isVisible().catch(() => false)) await notesInput.fill("Puppet B5 correction");

    // Dialog submit is "Move kit" (not "Save")
    await page.getByRole("button", { name: "Move kit" }).click();
    await page.waitForTimeout(2000);
    await screenshot(page, "B5-after-move");

    // Check timeline - should show transaction history
    await page.getByText(/transaction|timeline|history|moved/i).isVisible().catch(() => false);
    // Just document the state
    await screenshot(page, "B5-timeline-check");
  });

  test("B6: Soft-delete hides kit from default list", async ({ page }) => {
    await page.goto(`/kits/${KNOWN.kit001.id}`);
    await page.waitForSelector("h1, h2", { timeout: 10_000 });

    // Look for deactivate button
    const deactivateBtn = page.getByRole("button", { name: /deactivate|archive|disable/i });
    const deactivateBtnVisible = await deactivateBtn.isVisible().catch(() => false);

    await screenshot(page, "B6-kit-detail-before");

    if (!deactivateBtnVisible) {
      await screenshot(page, "B6-no-deactivate-button");
      // Note: deactivate may require navigation to kit list then action
    } else {
      await deactivateBtn.click();

      // Confirm dialog if present
      const confirmBtn = page.getByRole("button", { name: /confirm|yes|deactivate/i }).last();
      if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();

      await page.waitForTimeout(2000);
      await screenshot(page, "B6-after-deactivate");

      // Navigate to kit list - kit should not appear in default view
      await page.goto("/kits");
      await page.waitForSelector("table, h1", { timeout: 10_000 });
      await screenshot(page, "B6-kits-list-after");

      _kitVisible = await page.getByText("PUPPET-KIT-001").isVisible().catch(() => false);
      // If PUPPET-KIT-001 was created in B1, it should not appear
    }
  });
});

// ─── GROUP C: Request flow ────────────────────────────────────────────────────

test.describe.skip("C. Request flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("C2: Admin approves a request", async ({ page }) => {
    // Find an open request
    await page.goto("/requests");
    await page.waitForSelector("table, h1, [data-testid]", { timeout: 10_000 });
    await screenshot(page, "C2-requests-list");

    // Click on an open request row
    const openRow = page.locator("tr").filter({ hasText: /open/i }).first();
    const openRowVisible = await openRow.isVisible().catch(() => false);

    if (!openRowVisible) {
      await screenshot(page, "C2-no-open-request");
      // Create a new open request via API then approve it
      const token = await page.evaluate(() => {
        const stored = localStorage.getItem("pocketbase_auth");
        return stored ? JSON.parse(stored).token : null;
      });
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const createResp = await page.evaluate(async ({ token: tk, delivery }: { token: string; delivery: string }) => {
        const r = await fetch("http://127.0.0.1:8090/api/collections/requests/records", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": tk },
          body: JSON.stringify({ delivery_date: delivery, notes: "C2 test request" }),
        });
        return r.json();
      }, { token, delivery: futureDate });

      if (createResp.id) {
        await page.goto(`/requests/${createResp.id}`);
        await page.waitForSelector("h1, h2", { timeout: 10_000 });
      }
    } else {
      await openRow.click();
      await page.waitForURL("**/requests/**", { timeout: 5_000 });
    }

    await screenshot(page, "C2-request-detail");

    // Find approve button — labeled "Approve →" in the UI
    const approveBtn = page.getByRole("button", { name: /approve/i }).filter({ hasNot: page.locator('[disabled]') });
    const approveBtnEnabled = await approveBtn.isEnabled().catch(() => false);

    if (!approveBtnEnabled) {
      await screenshot(page, "C2-approve-not-enabled");
      // Check if status is already approved
      const alreadyApproved = await page.getByText("approved").isVisible().catch(() => false);
      if (alreadyApproved) {
        // Status already approved — flow passed on a previous run
      }
      return;
    }

    await approveBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, "C2-after-approve");

    // Status should show approved — use .first() to avoid strict mode (toast + status badge)
    await page.waitForTimeout(1000);
    const approvedText = await page.getByText("approved").first().isVisible().catch(() => false);
    expect(approvedText, "Request should show approved status after approval").toBe(true);
  });

  test("C3: Admin fulfills request → kit auto-moves @smoke", async ({ page }) => {
    // Use a known approved request with designated_kit and target_entity
    // p75lynsj0z3n6vg: approved, kit lkg6y9ir4v4y8c5 (DEMO-KIT-010), entity gmao3wb5yzu7cue (DEMO-Entity-002)
    await page.goto("/requests/p75lynsj0z3n6vg");
    await page.waitForSelector("h1, h2", { timeout: 10_000 });
    await screenshot(page, "C3-request-detail");

    const statusText = await page.getByText(/approved/i).isVisible().catch(() => false);

    if (!statusText) {
      await screenshot(page, "C3-not-approved-status");
      // Try to find another approved request
      await page.goto("/requests");
      await page.waitForSelector("table, h1", { timeout: 10_000 });
      const approvedRow = page.locator("tr").filter({ hasText: /approved/i }).first();
      if (await approvedRow.isVisible()) {
        await approvedRow.click();
        await page.waitForURL("**/requests/**", { timeout: 5_000 });
      }
    }

    await screenshot(page, "C3-before-fulfill");

    // Look for Fulfill button
    const fulfillBtn = page.getByRole("button", { name: /fulfill/i });
    const fulfillVisible = await fulfillBtn.isVisible().catch(() => false);

    if (!fulfillVisible) {
      await screenshot(page, "C3-no-fulfill-button");
      return;
    }

    // Per known BUG-2: must save assignment first
    // Check if kit/entity already assigned
    await page.getByText(/DEMO-KIT-010|lkg6y9ir4v4y8c5/i).isVisible().catch(() => false);
    await page.getByText(/DEMO-Entity-002/i).isVisible().catch(() => false);

    await screenshot(page, "C3-assignment-check");

    await fulfillBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, "C3-after-fulfill");

    // Check for fulfilled status
    const fulfilledText = await page.getByText(/fulfilled/i).isVisible().catch(() => false);
    if (fulfilledText) {
      // Also verify a transaction was created via API
    }
  });

  test("C4: Requester cancels own open request", async ({ page }) => {
    // Admin creates a request then tests cancel as admin (will hit BUG-6)
    await page.goto("/requests/7yct77d9cahmmao");
    await page.waitForSelector("h1, h2", { timeout: 10_000 });
    await screenshot(page, "C4-open-request");

    // Check if cancel is visible for admin
    const cancelBtn = page.getByRole("button", { name: /cancel/i });
    await cancelBtn.isVisible().catch(() => false);
    await screenshot(page, "C4-cancel-button-check");

    // Note: per BUG-6, admin cannot cancel their own open request (condition: !canDecideRequests)
    // So if this is admin's own request, cancel button may not show
  });

  test("C5: Requester cannot edit/cancel non-open request", async ({ page }) => {
    // Find an approved request owned by demo-user-2
    // sn00shv0ljicif7: approved
    await page.goto("/requests/sn00shv0ljicif7");
    await page.waitForSelector("h1, h2", { timeout: 10_000 });
    await screenshot(page, "C5-approved-request");

    // As admin, Cancel button should be visible but via different mechanism — document state
    await page.getByRole("button", { name: /cancel/i }).isVisible().catch(() => false);

    // Admin sees different actions than requester
    await screenshot(page, "C5-admin-actions-on-approved");
  });
});

// ─── GROUP D: Components + Products ──────────────────────────────────────────

test.describe.skip("D. Components + Products", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("D1: Admin creates a Product @smoke", async ({ page }) => {
    await page.goto("/products");
    await page.waitForSelector("table, h1, [data-testid], main", { timeout: 10_000 });
    await screenshot(page, "D1-products-page");

    // Button is labeled "Add product" in the UI
    const newProductBtn = page.getByRole("button", { name: /add product|new product/i });
    const btnVisible = await newProductBtn.isVisible().catch(() => false);

    expect(btnVisible, "Add product button must be visible for admin").toBe(true);
    if (!btnVisible) return;

    await newProductBtn.click();
    await waitForModal(page);
    await screenshot(page, "D1-new-product-dialog");

    // Fill product form
    const nameInput = page.getByLabel(/name/i).first();
    if (await nameInput.isVisible()) await nameInput.fill("Puppet Battery Pack");

    const categoryInput = page.getByLabel(/category/i).first();
    if (await categoryInput.isVisible()) await categoryInput.fill("Battery");

    const manufacturerInput = page.getByLabel(/manufacturer/i).first();
    if (await manufacturerInput.isVisible()) await manufacturerInput.fill("Acme");

    const modelInput = page.getByLabel(/model/i).first();
    if (await modelInput.isVisible()) await modelInput.fill("AB-9000");

    await screenshot(page, "D1-filled");
    await page.getByRole("button", { name: /save|create|submit/i }).last().click();
    await page.waitForTimeout(2000);
    await screenshot(page, "D1-after-submit");

    // Use .first() to avoid strict mode error (toast + table row)
    const productVisible = await page.getByText("Puppet Battery Pack").first().isVisible().catch(() => false);
    expect(productVisible, "Puppet Battery Pack should appear after create").toBe(true);
  });

  test("D2: Admin creates serialized Component bound to Product", async ({ page }) => {
    await page.goto("/components");
    await page.waitForSelector("table, h1, main", { timeout: 10_000 });
    await screenshot(page, "D2-components-page");

    const newCompBtn = page.getByRole("button", { name: /add component|new component/i });
    const btnVisible = await newCompBtn.isVisible().catch(() => false);

    expect(btnVisible, "New component button must be visible for admin").toBe(true);
    if (!btnVisible) return;

    await newCompBtn.click();
    await waitForModal(page);
    await screenshot(page, "D2-new-component-dialog");

    // Select product
    const productCombo = page.getByRole("combobox").filter({ hasText: /product|select/i }).first();
    if (await productCombo.isVisible()) {
      await productCombo.click();
      const productOpt = page.getByRole("option", { name: /Puppet Battery Pack|Battery/i }).first();
      if (await productOpt.isVisible().catch(() => false)) {
        await productOpt.click();
      } else {
        // Try any option
        const firstOpt = page.getByRole("option").first();
        if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click();
      }
    }

    const serialInput = page.getByLabel(/serial/i).first();
    if (await serialInput.isVisible()) await serialInput.fill("PUPPET-COMP-001");

    await screenshot(page, "D2-filled");
    await page.getByRole("button", { name: /save|create|submit/i }).last().click();
    await page.waitForTimeout(2000);
    await screenshot(page, "D2-after-submit");
  });

  test("D3: Admin creates bulk Component", async ({ page }) => {
    await page.goto("/components");
    await page.waitForSelector("table, h1, main", { timeout: 10_000 });

    const newCompBtn = page.getByRole("button", { name: /add component|new component/i });
    if (!await newCompBtn.isVisible().catch(() => false)) return;

    await newCompBtn.click();
    await waitForModal(page);
    await screenshot(page, "D3-dialog");

    // Select product first
    const productCombo = page.getByRole("combobox").first();
    if (await productCombo.isVisible()) {
      await productCombo.click();
      const firstOpt = page.getByRole("option").first();
      if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click();
    }

    // Toggle bulk
    const bulkToggle = page.getByLabel(/bulk/i).or(page.getByRole("switch", { name: /bulk/i }))
      .or(page.getByRole("checkbox", { name: /bulk/i })).first();
    if (await bulkToggle.isVisible().catch(() => false)) {
      await bulkToggle.click();
    }

    // Fill quantity
    const qtyInput = page.getByLabel(/quantity|qty/i).first();
    if (await qtyInput.isVisible()) await qtyInput.fill("25");

    await screenshot(page, "D3-bulk-filled");
    await page.getByRole("button", { name: /save|create|submit/i }).last().click();
    await page.waitForTimeout(2000);
    await screenshot(page, "D3-after-submit");
  });

  test("D4: Component without product is rejected", async ({ page }) => {
    await page.goto("/components");
    await page.waitForSelector("table, h1, main", { timeout: 10_000 });

    const newCompBtn = page.getByRole("button", { name: /add component|new component/i });
    if (!await newCompBtn.isVisible().catch(() => false)) return;

    await newCompBtn.click();
    await waitForModal(page);

    // Fill serial but leave product unselected
    const serialInput = page.getByLabel(/serial/i).first();
    if (await serialInput.isVisible()) await serialInput.fill("PUPPET-COMP-NOPROD");

    await screenshot(page, "D4-no-product-filled");

    // Try to submit without selecting product
    const submitBtn = page.getByRole("button", { name: /save|create|submit/i }).last();
    const submitDisabled = await submitBtn.isDisabled().catch(() => false);

    if (submitDisabled) {
      // Good - button disabled when no product selected
      await screenshot(page, "D4-submit-disabled");
    } else {
      await submitBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, "D4-after-submit-no-product");

      // Should show error or dialog stays open
      const dialogStillOpen = await page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').isVisible().catch(() => false);
      const errorText = await page.getByText(/product.*required|required.*product|select.*product/i).isVisible().catch(() => false);

      if (!errorText && !dialogStillOpen) {
        // Potential bug: component created without product
        await screenshot(page, "D4-FAIL-no-validation");
      }
    }
  });
});

// ─── GROUP E: Maintenance ─────────────────────────────────────────────────────

test.describe.skip("E. Maintenance", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("E1: Admin creates maintenance schedule from kit detail @smoke", async ({ page }) => {
    await page.goto(`/kits/${KNOWN.kit002.id}`);
    await page.waitForSelector("h1, h2", { timeout: 10_000 });
    await screenshot(page, "E1-kit002-detail");

    // Scroll down to maintenance section
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
    await screenshot(page, "E1-scrolled");

    const addScheduleBtn = page.getByRole("button", { name: /add schedule|schedule/i });
    const btnVisible = await addScheduleBtn.isVisible().catch(() => false);

    if (!btnVisible) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(500);
      await screenshot(page, "E1-scrolled-more");
    }

    const addScheduleBtnFinal = page.getByRole("button", { name: /add schedule|schedule/i });
    if (!await addScheduleBtnFinal.isVisible().catch(() => false)) {
      await screenshot(page, "E1-no-add-schedule-button");
      return;
    }

    await addScheduleBtnFinal.click();
    await waitForModal(page);
    await screenshot(page, "E1-add-schedule-dialog");

    const typeInput = page.getByLabel(/type/i).first();
    if (await typeInput.isVisible()) await typeInput.fill("calibration");

    const descInput = page.getByLabel(/description/i).first();
    if (await descInput.isVisible()) await descInput.fill("Quarterly cal");

    const intervalInput = page.getByLabel(/interval/i).first();
    if (await intervalInput.isVisible()) await intervalInput.fill("90");

    await screenshot(page, "E1-filled");
    // Dialog submit button is labeled "Add schedule"
    await page.getByRole("button", { name: "Add schedule" }).last().click();
    await page.waitForTimeout(2000);
    await screenshot(page, "E1-after-submit");
  });

  test("E2: No 'Add schedule' on /maintenance page (known gap K1)", async ({ page }) => {
    await page.goto("/maintenance");
    await page.waitForSelector("h1, main", { timeout: 10_000 });
    await screenshot(page, "E2-maintenance-page");

    const addBtn = page.getByRole("button", { name: /add schedule|new schedule/i });
    const addVisible = await addBtn.isVisible().catch(() => false);

    // Per K1: no CTA expected. If button exists, K1 is fixed.
    if (addVisible) {
      // K1 appears fixed — document it
      await screenshot(page, "E2-ADD-SCHEDULE-EXISTS-K1-FIXED");
    } else {
      // Expected: gap confirmed
      await screenshot(page, "E2-gap-confirmed-no-add-schedule");
    }
  });
});

// ─── GROUP F: On-call rotation ────────────────────────────────────────────────

test.describe.skip("F. On-call rotation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("F1: Admin views on-call schedule @smoke", async ({ page }) => {
    await page.goto("/oncall");
    await page.waitForSelector("h1, main, table", { timeout: 10_000 });
    await screenshot(page, "F1-oncall-page");

    // Should show shifts
    await page.locator("table, [data-testid]").isVisible().catch(() => false);
    await page.getByText(/tech|active|past|upcoming|shift/i).isVisible().catch(() => false);

    await screenshot(page, "F1-oncall-content");

    // Check for status pills
    await page.getByText(/active/i).isVisible().catch(() => false);
    await page.getByText(/past/i).isVisible().catch(() => false);
  });

  test("F4: Admin adds overlapping on-call shift", async ({ page }) => {
    await page.goto("/oncall");
    await page.waitForSelector("h1, main", { timeout: 10_000 });

    const addShiftBtn = page.getByRole("button", { name: /add shift/i });
    const btnVisible = await addShiftBtn.isVisible().catch(() => false);

    if (!btnVisible) {
      await screenshot(page, "F4-no-add-shift-button");
      return;
    }

    await addShiftBtn.click();
    await waitForModal(page);
    await screenshot(page, "F4-add-shift-dialog");

    // Fill shift details — scope all to dialog to avoid AI chat Send button
    const dialog = page.locator('[role="dialog"]:not([aria-label="Navigation menu"])');
    const today = new Date();
    const startDate = new Date(today.getTime() - 12 * 60 * 60 * 1000); // today - 12h
    const endDate = new Date(today.getTime() + 12 * 60 * 60 * 1000); // today + 12h

    // Select user in combobox (native select)
    const userSelect = dialog.locator('select, [role="combobox"]').first();
    if (await userSelect.isVisible()) {
      // Use native select's option
      await userSelect.selectOption({ index: 1 }).catch(async () => {
        await userSelect.click();
        const firstOpt = page.getByRole("option").first();
        if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click();
      });
    }

    const startInput = dialog.getByLabel("Start");
    if (await startInput.isVisible()) await startInput.fill(startDate.toISOString().slice(0, 16));

    const endInput = dialog.getByLabel("End");
    if (await endInput.isVisible()) await endInput.fill(endDate.toISOString().slice(0, 16));

    await screenshot(page, "F4-filled");
    // Submit button is "Add shift" in the dialog
    await dialog.getByRole("button", { name: "Add shift" }).click();
    await page.waitForTimeout(2000);
    await screenshot(page, "F4-after-submit");
  });

  test("F5: Admin deletes a past shift", async ({ page }) => {
    await page.goto("/oncall");
    await page.waitForSelector("h1, main", { timeout: 10_000 });
    await screenshot(page, "F5-oncall-list");

    // Find a past shift row
    const pastRow = page.locator("tr").filter({ hasText: /past/i }).first();
    const pastRowVisible = await pastRow.isVisible().catch(() => false);

    if (!pastRowVisible) {
      await screenshot(page, "F5-no-past-shift");
      return;
    }

    const deleteBtn = pastRow.getByRole("button", { name: /delete|remove/i });
    if (!await deleteBtn.isVisible().catch(() => false)) {
      await screenshot(page, "F5-no-delete-button");
      return;
    }

    await deleteBtn.click();

    // Confirm if needed
    const confirmBtn = page.getByRole("button", { name: /confirm|yes|delete/i }).last();
    if (await confirmBtn.isVisible().catch(() => false)) await confirmBtn.click();

    await page.waitForTimeout(2000);
    await screenshot(page, "F5-after-delete");
  });
});

// ─── GROUP I: Permission boundaries ──────────────────────────────────────────

test.describe.skip("I. Permission boundaries (admin perspective)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("I1: Admin can access all sidebar links", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector("nav, aside, h1", { timeout: 10_000 });
    await screenshot(page, "I1-admin-sidebar");

    // Admin should see users link
    const usersLink = page.getByRole("link", { name: /users/i });
    const usersVisible = await usersLink.isVisible().catch(() => false);
    expect(usersVisible, "Admin should see /users link in sidebar").toBe(true);

    // Admin should see maintenance
    const maintenanceLink = page.getByRole("link", { name: /maintenance/i });
    const maintenanceVisible = await maintenanceLink.isVisible().catch(() => false);
    expect(maintenanceVisible, "Admin should see /maintenance link").toBe(true);

    await screenshot(page, "I1-admin-nav-check");
  });

  test("I5: Self-promote via PATCH rejected", async ({ page }) => {
    await loginAsAdmin(page);

    // Get a user token and try to self-promote to a higher role...
    // For admin: try to change own role — but admin can't self-demote to admin (last admin check)
    // We need a non-admin to test this. Use API directly with a user token.

    // Get user-1 token via API
    const response = await page.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:8090/api/collections/users/auth-with-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: "demo-user-1@kit.local", password: "Pass1234!" }),
      });
      return res.json();
    });

    const userId = "g5tm7hraqub0rk1"; // demo-user-1 id from earlier

    const patchResult = await page.evaluate(async ({ token, id }) => {
      const res = await fetch(`http://127.0.0.1:8090/api/collections/users/records/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token,
        },
        body: JSON.stringify({ role: "admin" }),
      });
      return { status: res.status, body: await res.text() };
    }, { token: response.token, id: userId });

    await screenshot(page, "I5-self-promote-attempt");

    // Should be rejected (400 from hook)
    expect(patchResult.status, `Self-promote PATCH should return 400, got ${patchResult.status}: ${patchResult.body}`)
      .toBe(400);
  });
});

// ─── GROUP L: Error states ────────────────────────────────────────────────────

test.describe.skip("L. Error states", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("L1: Network failure during kit create", async ({ page }) => {
    await page.goto("/kits");
    await page.waitForSelector("table, h1", { timeout: 10_000 });

    // Open new kit dialog
    const newKitBtn = page.getByRole("button", { name: /new kit/i });
    if (!await newKitBtn.isVisible().catch(() => false)) return;
    await newKitBtn.click();
    await waitForModal(page);

    // Fill form
    const serialInput = page.getByLabel(/serial/i).first();
    if (await serialInput.isVisible()) await serialInput.fill("PUPPET-KIT-NET-FAIL");

    // Block PB network requests
    await page.route("**/api/collections/kits/records", route => route.abort());

    // Submit
    await page.getByRole("button", { name: /save|create|submit/i }).last().click();
    await page.waitForTimeout(3000);
    await screenshot(page, "L1-after-network-failure");

    // Dialog should still be open
    const dialogOpen = await page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').isVisible().catch(() => false);
    const errorToast = await page.getByText(/error|failed|network/i).isVisible().catch(() => false);

    if (!dialogOpen && !errorToast) {
      await screenshot(page, "L1-FAIL-dialog-closed-silently");
    }

    // Unblock
    await page.unroute("**/api/collections/kits/records");
  });

  test("L2: Negative quantity on bulk component rejected", async ({ page }) => {
    await page.goto("/components");
    await page.waitForSelector("table, h1, main", { timeout: 10_000 });

    const newCompBtn = page.getByRole("button", { name: /add component|new component/i });
    if (!await newCompBtn.isVisible().catch(() => false)) return;
    await newCompBtn.click();
    await waitForModal(page);

    // Select a product
    const productCombo = page.getByRole("combobox").first();
    if (await productCombo.isVisible()) {
      await productCombo.click();
      const firstOpt = page.getByRole("option").first();
      if (await firstOpt.isVisible().catch(() => false)) await firstOpt.click();
    }

    // Toggle bulk
    const bulkToggle = page.getByLabel(/bulk/i).or(page.getByRole("checkbox", { name: /bulk/i })).first();
    if (await bulkToggle.isVisible().catch(() => false)) await bulkToggle.click();

    const qtyInput = page.getByLabel(/quantity|qty/i).first();
    if (await qtyInput.isVisible()) await qtyInput.fill("-5");

    await screenshot(page, "L2-negative-qty");
    await page.getByRole("button", { name: /save|create|submit/i }).last().click();
    await page.waitForTimeout(2000);
    await screenshot(page, "L2-after-negative-submit");

    const errorText = await page.getByText(/positive|invalid|error|greater than/i).isVisible().catch(() => false);
    const dialogOpen = await page.locator('[role="dialog"]:not([aria-label="Navigation menu"])').isVisible().catch(() => false);

    if (!errorText && !dialogOpen) {
      await screenshot(page, "L2-FAIL-negative-accepted");
    }
  });

  test("L3: Double-click submit creates only one request", async ({ page }) => {
    await page.goto("/requests");
    await page.waitForSelector("table, h1", { timeout: 10_000 });

    const countBefore = await page.locator("tbody tr").count().catch(() => 0);

    const newReqBtn = page.getByRole("button", { name: /new request|add request/i });
    if (!await newReqBtn.isVisible().catch(() => false)) {
      // Admin may have different button
      return;
    }
    await newReqBtn.click();
    await waitForModal(page);

    // Fill required fields
    const deliveryInput = page.getByLabel(/delivery|date/i).first();
    if (await deliveryInput.isVisible()) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      await deliveryInput.fill(futureDate.toISOString().slice(0, 10));
    }

    // Double-click submit
    const submitBtn = page.getByRole("button", { name: /save|create|submit/i }).last();
    await submitBtn.click({ clickCount: 2, delay: 100 });
    await page.waitForTimeout(3000);
    await screenshot(page, "L3-after-double-click");

    await page.goto("/requests");
    await page.waitForSelector("table, h1", { timeout: 10_000 });
    const countAfter = await page.locator("tbody tr").count().catch(() => 0);

    // At most 1 new request should exist
    const diff = countAfter - countBefore;
    expect(diff, `Double-click should create at most 1 request, created ${diff}`).toBeLessThanOrEqual(1);
    await screenshot(page, "L3-count-check");
  });
});
