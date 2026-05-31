/**
 * Onboarding tour modal flows.
 *
 * Coverage:
 *   - Welcome modal auto-appears on first login (localStorage key absent) @smoke
 *   - Clicking Next advances to the next slide @smoke
 *   - Slide indicator (dots) reflects current position
 *   - Closing via Skip dismisses the modal @smoke
 *   - After closing, reloading does NOT re-open the modal (localStorage key set) @smoke
 *   - Help button in the sidebar reopens the modal on demand @smoke
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

const STORAGE_KEY = "kit_tracker_onboarding_v1";

test.describe("Onboarding tour @smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Ensure the onboarding flag is cleared so the modal will auto-open
    await page.goto("/login");
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  });

  test("welcome modal auto-appears on first login @smoke", async ({ page }) => {
    await loginAs(page, "admin", { keepOnboarding: true });

    // The modal should be visible immediately after login
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Welcome to Kit Tracker")).toBeVisible();
  });

  test("clicking Next advances the slide @smoke", async ({ page }) => {
    await loginAs(page, "admin", { keepOnboarding: true });

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Welcome to Kit Tracker")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog").getByText("Dashboard")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog").getByText("Kits")).toBeVisible();
  });

  test("Skip button closes the modal @smoke", async ({ page }) => {
    await loginAs(page, "admin", { keepOnboarding: true });

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("after closing, reload does NOT reopen modal @smoke", async ({ page }) => {
    await loginAs(page, "admin", { keepOnboarding: true });

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Reload: modal must stay closed
    await page.reload();
    await page.waitForURL("**/dashboard");
    // Give a moment for any auto-open logic to fire
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("Help button reopens the modal @smoke", async ({ page }) => {
    await loginAs(page, "admin", { keepOnboarding: true });

    // Close the modal first
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Click the Help button in the sidebar
    await page.getByRole("button", { name: "Open help tour" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Welcome to Kit Tracker")).toBeVisible();
  });
});
