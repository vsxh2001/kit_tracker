/**
 * Calendar/timeline view for requests.
 *
 * Coverage:
 *   1. Calendar page renders bars for a seeded approved request @smoke
 *   2. Status filter — only matching status bars shown
 *   3. Click bar navigates to /requests/:id
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  createTestRequest,
  updateRequestStatus,
  getUserIdByEmail,
} from "./helpers/api";
import { CREDENTIALS } from "./helpers/auth";

const TS = `cal-${Date.now()}`;

test.describe("Requests calendar view", () => {
  let approvedRequestId: string;
  let openRequestId: string;
  let adminUserId: string;

  // Seed with delivery_date in the future so it falls in the 30-day window.
  const deliveryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const returnDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  test.beforeAll(async () => {
    adminUserId = await getUserIdByEmail(CREDENTIALS.admin.email);

    const approved = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-approved`,
      deliveryDate,
      status: "approved",
    });
    approvedRequestId = approved.id;

    // Patch expected_return onto the approved request
    await updateRequestStatus(approvedRequestId, "approved", {
      expected_return: returnDate,
    });

    const open = await createTestRequest({
      requesterId: adminUserId,
      notes: `${TS}-open`,
      deliveryDate,
      status: "open",
    });
    openRequestId = open.id;
  });

  test.afterAll(async () => {
    await updateRequestStatus(approvedRequestId, "cancelled").catch(() => {});
    await updateRequestStatus(openRequestId, "cancelled").catch(() => {});
  });

  test("calendar page renders bars for seeded approved request @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/requests/calendar");

    await expect(
      page.getByRole("heading", { name: "Requests Timeline" })
    ).toBeVisible();

    // At least one calendar bar should be visible
    await expect(page.locator("[data-testid='calendar-bar']").first()).toBeVisible({
      timeout: 8000,
    });
  });

  test("status filter — only approved requests shown when Approved selected", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/requests/calendar");

    // Wait for bars to load
    await expect(page.locator("[data-testid='calendar-bar']").first()).toBeVisible({
      timeout: 8000,
    });

    // Click "Approved" filter
    await page.getByRole("button", { name: "approved" }).click();

    // Approved request bar should be visible
    await expect(
      page.locator(`[data-request-id="${approvedRequestId}"]`)
    ).toBeVisible({ timeout: 5000 });

    // Open request bar should NOT be visible
    await expect(
      page.locator(`[data-request-id="${openRequestId}"]`)
    ).not.toBeVisible();
  });

  test("click bar navigates to /requests/:id", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/requests/calendar");

    await expect(page.locator("[data-testid='calendar-bar']").first()).toBeVisible({
      timeout: 8000,
    });

    // Click the bar for the approved request
    await page.locator(`[data-request-id="${approvedRequestId}"]`).click();

    await expect(page).toHaveURL(new RegExp(`/requests/${approvedRequestId}`), {
      timeout: 5000,
    });
  });
});
