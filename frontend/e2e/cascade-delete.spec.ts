/**
 * Cascade delete UI smoke spec (T25).
 *
 * Verifies:
 *   - Admin sees "Cascade Hard Delete" button on /kits/:id (Danger Zone card)
 *   - Non-admin (viewer) does NOT see Danger Zone / Cascade Hard Delete button
 *   - Clicking Cascade Hard Delete opens CascadeDeleteDialog
 *     (dialog title contains "Hard delete")
 *
 * Does NOT execute an actual deletion — full delete flow is covered by T26.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit } from "./helpers/api";

const TS = `cascade-${Date.now()}`;

test.describe("Cascade delete — Danger Zone button gating @smoke", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-KIT`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("admin sees Cascade Hard Delete button on kit detail @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: "Cascade Hard Delete" })).toBeVisible();
  });

  test("viewer does NOT see Cascade Hard Delete button on kit detail @smoke", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto(`/kits/${kitId}`);
    await expect(page.getByRole("button", { name: "Cascade Hard Delete" })).not.toBeVisible();
  });

  test("clicking Cascade Hard Delete opens dialog with 'Hard delete' title @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);
    await page.getByRole("button", { name: "Cascade Hard Delete" }).click();
    // Dialog title: "Hard delete kit '<serial>' with cascade?" or loading state
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/[Hh]ard delete/);
  });
});
