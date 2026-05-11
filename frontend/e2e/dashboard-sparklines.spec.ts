import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Dashboard sparklines", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard");
    // Wait for loading to finish
    await expect(page.getByText("Total kits")).toBeVisible();
    await page.waitForFunction(() => !document.querySelector('[class*="Loading"]'));
  });

  test("dashboard renders SVG sparklines on at least 2 KPI cards @smoke", async ({ page }) => {
    // Wait for stat cards to be rendered (not loading)
    await page.waitForSelector("svg", { timeout: 10000 });
    const svgs = page.locator("main svg");
    const count = await svgs.count();
    expect(count, "Should have at least 2 sparkline SVGs").toBeGreaterThanOrEqual(2);
  });

  test("sparkline SVG has correct number of points matching data length @smoke", async ({ page }) => {
    await page.waitForSelector("svg polyline", { timeout: 10000 });
    const polylines = page.locator("main svg polyline");
    const count = await polylines.count();
    expect(count, "Should have at least 2 polylines").toBeGreaterThanOrEqual(2);

    // Each polyline should have 7 points (one per day)
    const firstPolyline = polylines.first();
    const points = await firstPolyline.getAttribute("points");
    expect(points).toBeTruthy();
    const pointCount = points!.trim().split(/\s+/).length;
    expect(pointCount, "Sparkline should have 7 data points").toBe(7);
  });
});
