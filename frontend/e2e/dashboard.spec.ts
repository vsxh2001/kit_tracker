/**
 * Dashboard page flows.
 *
 * Coverage:
 *   - Dashboard renders stat cards: Total kits, Open requests, Awaiting fulfillment, Total requests
 *   - Stat card values are numeric
 *   - Recent transactions table shows Time/Kit/From/To/Notes columns
 *   - Sidebar navigation links are all present
 *   - Sidebar shows logged-in user's email
 *   - All nav links navigate to the correct pages
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestKit,
  createTestEntity,
  createTestTransaction,
  deleteKit,
  deactivateEntity,
} from "./helpers/api";

test.describe("Dashboard page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");
  });

  test("renders all four stat cards @smoke", async ({ page }) => {
    await expect(page.getByText("Total kits")).toBeVisible();
    await expect(page.getByText("Open requests")).toBeVisible();
    await expect(page.getByText("Awaiting fulfillment")).toBeVisible();
    await expect(page.getByText("Total requests")).toBeVisible();
  });

  test("stat card values are numeric @smoke", async ({ page }) => {
    // All stat card values should be non-negative integers
    const statValues = page.locator("main").getByText(/^\d+$/);
    await expect(statValues.first()).toBeVisible();
    const count = await statValues.count();
    expect(count, "Should have at least 4 stat values").toBeGreaterThanOrEqual(4);
  });

  test("recent transactions table has correct columns", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Recent transactions" })
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Time" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Kit" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "From" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "To" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
  });

  test("sidebar shows logged-in user email @smoke", async ({ page }) => {
    await expect(page.getByRole("complementary").getByText("logistics@kit.local")).toBeVisible();
  });

  test("sidebar navigation links are all present", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kits" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Requests" })).toBeVisible();
  });
});

test.describe("Dashboard navigation links", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");
  });

  test("Kits nav link navigates to /kits", async ({ page }) => {
    await page.getByRole("link", { name: "Kits" }).click();
    await expect(page).toHaveURL(/\/kits$/);
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
  });

  test("Entities nav link navigates to /entities", async ({ page }) => {
    await page.getByRole("link", { name: "Entities" }).click();
    await expect(page).toHaveURL(/\/entities$/);
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
  });

  test("Requests nav link navigates to /requests", async ({ page }) => {
    await page.getByRole("link", { name: "Requests" }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  });

  test("root URL redirects to /dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("unknown route redirects to /dashboard", async ({ page }) => {
    await page.goto("/this-does-not-exist");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("Dashboard — viewer access", () => {
  test("viewer can access dashboard and sees stat cards", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/dashboard");
    await expect(page.getByText("Total kits")).toBeVisible();
    await expect(page.getByRole("complementary").getByText("viewer@kit.local")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Clickable dashboard — stat cards navigate
// ---------------------------------------------------------------------------

test.describe("Dashboard — clickable stat cards", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");
  });

  test("'Total kits' stat card navigates to /kits", async ({ page }) => {
    await page.getByText("Total kits").click();
    await expect(page).toHaveURL(/\/kits$/);
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
  });

  test("'Open requests' stat card navigates to /requests", async ({ page }) => {
    await page.getByText("Open requests").click();
    await expect(page).toHaveURL(/\/requests\?status=open$/);
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  });

  test("'Awaiting fulfillment' stat card navigates to /requests", async ({
    page,
  }) => {
    await page.getByText("Awaiting fulfillment").click();
    await expect(page).toHaveURL(/\/requests\?status=approved$/);
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  });

  test("'Total requests' stat card navigates to /requests", async ({ page }) => {
    await page.getByText("Total requests").click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Clickable dashboard — transaction row links to kit detail
// ---------------------------------------------------------------------------

test.describe("Dashboard — clickable transaction rows", () => {
  const TS_DASH = `dash-${Date.now()}`;
  let kitId: string;
  let entityId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS_DASH}-KIT`);
    kitId = kit.id;
    const entity = await createTestEntity(`${TS_DASH}-ENT`);
    entityId = entity.id;
    // Create a transaction so this kit shows up in Recent transactions
    await createTestTransaction({ kitId, toEntityId: entityId });
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
    await deactivateEntity(entityId);
  });

  test("clicking a transaction row navigates to the kit detail page", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");

    // Wait for the recent transactions table to render our kit
    await expect(
      page.getByRole("cell", { name: `${TS_DASH}-KIT` })
    ).toBeVisible({ message: "Test kit should appear in recent transactions" });

    // Click the row containing our kit serial
    await page
      .getByRole("row")
      .filter({ hasText: `${TS_DASH}-KIT` })
      .first()
      .click();

    // Should navigate to /kits/<kitId>
    await expect(page).toHaveURL(new RegExp(`/kits/${kitId}`));
  });
});
