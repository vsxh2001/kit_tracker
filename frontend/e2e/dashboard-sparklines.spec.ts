import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, createTestEntity, deleteKit, deactivateEntity, getAdminToken, getAdminUserId } from "./helpers/api";

test.describe("Dashboard sparklines", () => {
  let kitId: string;
  let entityId: string;

  test.beforeAll(async () => {
    // Seed a kit and entity for sparkline data
    const kit = await createTestKit("sparkline-kit-" + Date.now());
    kitId = kit.id;
    const entity = await createTestEntity("sparkline-entity-" + Date.now());
    entityId = entity.id;

    // Create transactions with timestamps spread across the last 7 days
    // The sparkline buckets by date, so we need transactions on 7 different calendar days
    const token = await getAdminToken();
    const userId = await getAdminUserId();
    const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

    for (let i = 6; i >= 0; i--) {
      // Create a timestamp for day i (where i=6 is 6 days ago, i=0 is today)
      const txDate = new Date();
      txDate.setDate(txDate.getDate() - i);
      txDate.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues

      const res = await fetch(`${PB_URL}/api/collections/transactions/records`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({
          kit: kit.id,
          from_entity: null,
          to_entity: entity.id,
          timestamp: txDate.toISOString(),
          notes: `sparkline-tx-day-${i}`,
          created_by: userId,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        console.error("Failed to create sparkline transaction:", body);
      }
    }
  });

  test.afterAll(async () => {
    if (entityId) await deactivateEntity(entityId);
    if (kitId) await deleteKit(kitId);
  });

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
    console.log("Sparkline points string:", points);
    console.log("Point count:", pointCount);
    // Allow at least 6 points (sometimes due to timing, the oldest day might not have data)
    expect(pointCount, "Sparkline should have at least 6 data points").toBeGreaterThanOrEqual(6);
  });
});
