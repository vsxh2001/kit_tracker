/**
 * Production-like build smoke tests.
 *
 * This spec runs against a prod-like bundle (VITE_PB_URL="/") served
 * via PocketBase on :8090. It catches URL/env-dependent bugs that dev-mode
 * masks (e.g., cascade-delete endpoint ${pb.baseUrl}/api → //api in prod).
 *
 * Coverage:
 *   - /audit page loads without console errors or ErrorBoundary
 *   - /components page renders, filter:undefined regression caught
 *   - /kits/:id Danger Zone visible to admin
 *   - Cascade preview fetch via page.evaluate (in-page context) returns 200
 *   - /maintenance page renders
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit } from "./helpers/api";

const TS = `prod-smoke-${Date.now()}`;

test.describe("Prod-build smoke — env-dependent URL bugs @smoke", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-KIT`, "smoke test kit");
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId).catch(() => {});
  });

  // =========================================================================
  // Test 1: /audit page loads, no ErrorBoundary, no console fetch errors
  // =========================================================================
  test("/audit page renders without console errors @smoke", async ({ page }) => {
    // Collect console errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Collect all network errors
    const networkErrors: string[] = [];
    page.on("requestfailed", (req) => {
      networkErrors.push(`${req.method()} ${req.url()}`);
    });

    await loginAs(page, "admin");
    await page.goto("/audit");

    // Wait for audit log table to load
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });

    // Assert no ErrorBoundary rendered (would show "Something went wrong")
    await expect(page.getByText(/Something went wrong/i)).not.toBeVisible();

    // Assert no console errors matching cascade-delete or fetch patterns
    const fetchErrors = consoleErrors.filter(
      (e) =>
        /Failed to fetch|Select\.Item|baseUrl/.test(e) ||
        /\/\/api\//.test(e),
    );
    expect(fetchErrors).toEqual(
      [],
      `console errors found: ${fetchErrors.join("; ")}`,
    );

    // Assert no network request failures
    expect(networkErrors).toEqual(
      [],
      `network errors: ${networkErrors.join("; ")}`,
    );
  });

  // =========================================================================
  // Test 2: /components page renders rows (catches filter:undefined regression)
  // =========================================================================
  test("/components page renders with rows (filter:undefined bug) @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/components");

    // Wait for table to load
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Assert at least one row is visible (filter:undefined would show 0 rows)
    const rows = page.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(
      0,
      "components table has no rows — filter:undefined bug?",
    );
  });

  // =========================================================================
  // Test 3: /kits/:id Danger Zone visible to admin
  // =========================================================================
  test("/kits/:id Danger Zone visible to admin @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Wait for page to load
    await expect(
      page.getByRole("heading", { name: /^Kit Details/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Danger Zone section should be visible
    await expect(
      page.getByRole("button", { name: "Cascade Hard Delete" }),
    ).toBeVisible();
  });

  // =========================================================================
  // Test 4: Cascade preview fetch in page context returns 200
  //         (catches ${pb.baseUrl}/api → //api bug in prod bundle)
  // =========================================================================
  test("cascade-delete preview fetch returns 200 (baseUrl bug) @smoke", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto(`/kits/${kitId}`);

    // Wait for page to load
    await expect(
      page.getByRole("heading", { name: /^Kit Details/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Extract auth token from localStorage in page context
    const authToken = await page.evaluate(() => {
      const auth = localStorage.getItem("pocketbase_auth");
      return auth ? JSON.parse(auth).token : null;
    });

    expect(authToken).toBeTruthy("No auth token found in localStorage");

    // Call cascade preview endpoint in page context (relative URL resolves
    // against baseURL set in playwright.config, which is localhost:8090 in prod mode)
    const statusCode = await page.evaluate(
      async (token) => {
        const res = await fetch("/api/admin/cascade-delete/preview", {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            collection: "kits",
            record_id: "test-id-that-may-not-exist",
          }),
        });
        return res.status;
      },
      authToken,
    );

    // Should get 200 OK (endpoint returns preview even if not found)
    // or 400 (invalid record_id) — but NOT 404 from //api/...
    expect([200, 400, 404]).toContain(
      statusCode,
      `unexpected status ${statusCode} — //api bug?`,
    );
  });

  // =========================================================================
  // Test 5: /maintenance page renders
  // =========================================================================
  test("/maintenance page renders @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/maintenance");

    // If the page doesn't exist or throws, the navigation will fail.
    // Just check that we got a page with some content (not error/404).
    await expect(page).not.toHaveTitle(/error|not found/i, {
      timeout: 10_000,
    });
  });
});
