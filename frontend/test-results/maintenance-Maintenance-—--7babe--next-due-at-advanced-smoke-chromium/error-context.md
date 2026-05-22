# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: maintenance.spec.ts >> Maintenance — snooze schedule @smoke >> admin clicks Snooze on a schedule, picks 7 days, sees toast, next_due_at advanced @smoke
- Location: e2e/maintenance.spec.ts:299:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('row', { name: /inspection/ }).getByRole('button', { name: 'Snooze' })
Expected: visible
Error: strict mode violation: getByRole('row', { name: /inspection/ }).getByRole('button', { name: 'Snooze' }) resolved to 8 elements:
    1) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(77) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    2) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(80) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    3) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(83) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    4) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(86) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    5) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(89) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    6) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(92) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    7) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(95) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')
    8) <button class="text-xs px-2 py-1 rounded border border-border hover:bg-slate-50 transition-colors whitespace-nowrap">Snooze</button> aka locator('tr:nth-child(97) > .px-4.py-3.text-right > .inline-flex > button:nth-child(3)')

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('row', { name: /inspection/ }).getByRole('button', { name: 'Snooze' })

```

# Test source

```ts
  208 |     await expect(page.getByRole("button", { name: "Due soon" })).toBeVisible();
  209 |     await expect(page.getByRole("button", { name: "OK" })).toBeVisible();
  210 | 
  211 |     // Table column headers visible on desktop (wait for table to load)
  212 |     await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });
  213 |     await expect(page.locator("thead th").first()).toBeVisible();
  214 |     // Verify key columns exist (Target, Type, Next due)
  215 |     const headers = await page.locator("thead th").allTextContents();
  216 |     expect(headers.join(",")).toContain("Target");
  217 |     expect(headers.join(",")).toContain("Type");
  218 |     expect(headers.join(",")).toContain("Next due");
  219 |   });
  220 | });
  221 | 
  222 | // ---------------------------------------------------------------------------
  223 | // Test 4: /kits shows next-maintenance column for kit with schedule
  224 | // ---------------------------------------------------------------------------
  225 | 
  226 | test.describe("Kits page — next maintenance column", () => {
  227 |   let kitId: string;
  228 |   let schedId: string;
  229 | 
  230 |   test.beforeAll(async () => {
  231 |     const kit = await createTestKit(`${TS}-COL`);
  232 |     kitId = kit.id;
  233 |     const sched = await createScheduleViaApi(kitId, "calibration", 7);
  234 |     schedId = sched.id;
  235 |   });
  236 | 
  237 |   test.afterAll(async () => {
  238 |     await deactivateSchedule(schedId);
  239 |     await deleteKit(kitId);
  240 |   });
  241 | 
  242 |   test("kits table shows next maintenance column", async ({ page }) => {
  243 |     await loginAs(page, "admin");
  244 |     await page.goto("/kits");
  245 | 
  246 |     // Column header present
  247 |     await expect(page.getByRole("columnheader", { name: "Next maintenance" })).toBeVisible();
  248 |   });
  249 | });
  250 | 
  251 | // ---------------------------------------------------------------------------
  252 | // Test 5: Permission gate — viewer/user can't access /maintenance
  253 | // ---------------------------------------------------------------------------
  254 | 
  255 | test.describe("Maintenance — permission gate", () => {
  256 |   test("viewer does not see Maintenance nav link", async ({ page }) => {
  257 |     await loginAs(page, "viewer");
  258 |     await page.goto("/dashboard");
  259 |     // "Maintenance" nav link should NOT be present in sidebar
  260 |     await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
  261 |   });
  262 | 
  263 |   test("user role does not see Maintenance nav link", async ({ page }) => {
  264 |     await loginAs(page, "user");
  265 |     await page.goto("/dashboard");
  266 |     await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
  267 |   });
  268 | 
  269 |   test("viewer direct nav to /maintenance redirects to /dashboard", async ({ page }) => {
  270 |     await loginAs(page, "viewer");
  271 |     await page.goto("/maintenance");
  272 |     await page.waitForURL("**/dashboard", { timeout: 5000 });
  273 |   });
  274 | });
  275 | 
  276 | // ---------------------------------------------------------------------------
  277 | // Test 6: Admin snoozes a schedule (F6)
  278 | // ---------------------------------------------------------------------------
  279 | 
  280 | test.describe("Maintenance — snooze schedule @smoke", () => {
  281 |   let kitId: string;
  282 |   let schedId: string;
  283 |   let originalNextDue: string;
  284 | 
  285 |   test.beforeAll(async () => {
  286 |     const kit = await createTestKit(`${TS}-SNZ`);
  287 |     kitId = kit.id;
  288 |     const sched = await createScheduleViaApi(kitId, "inspection", 30);
  289 |     schedId = sched.id;
  290 |     const data = await getSchedule(schedId);
  291 |     originalNextDue = data.next_due_at.slice(0, 10);
  292 |   });
  293 | 
  294 |   test.afterAll(async () => {
  295 |     await deactivateSchedule(schedId);
  296 |     await deleteKit(kitId);
  297 |   });
  298 | 
  299 |   test("admin clicks Snooze on a schedule, picks 7 days, sees toast, next_due_at advanced @smoke", async ({ page }) => {
  300 |     await loginAs(page, "admin");
  301 |     await page.goto("/maintenance");
  302 | 
  303 |     // Wait for table to render
  304 |     await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });
  305 | 
  306 |     // Find Snooze button for our schedule row (inspection type visible in table)
  307 |     const snoozeBtn = page.getByRole("row", { name: /inspection/ }).getByRole("button", { name: "Snooze" });
> 308 |     await expect(snoozeBtn).toBeVisible({ timeout: 10_000 });
      |                             ^ Error: expect(locator).toBeVisible() failed
  309 |     await snoozeBtn.click();
  310 | 
  311 |     // Dialog opens
  312 |     await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  313 |     await expect(page.getByText("Snooze Schedule")).toBeVisible();
  314 | 
  315 |     // "7 days" button is default active — click Snooze to submit
  316 |     await page.getByRole("button", { name: "Snooze" }).last().click();
  317 | 
  318 |     // Toast appears
  319 |     await expect(page.locator("div:has-text('Schedule snoozed')").first()).toBeVisible({ timeout: 10_000 });
  320 | 
  321 |     // Verify next_due_at advanced 7 days via API
  322 |     const updated = await getSchedule(schedId);
  323 |     const origDate = new Date(originalNextDue + "T00:00:00Z");
  324 |     const newDate = new Date(updated.next_due_at.slice(0, 10) + "T00:00:00Z");
  325 |     const diffDays = Math.round((newDate.getTime() - origDate.getTime()) / 86400000);
  326 |     expect(diffDays).toBe(7);
  327 |   });
  328 | 
  329 |   test("viewer cannot see Snooze button on /maintenance", async ({ page }) => {
  330 |     await loginAs(page, "viewer");
  331 |     await page.goto("/dashboard");
  332 |     // Viewer is redirected from /maintenance; verify no Snooze button reachable via nav
  333 |     await expect(page.getByRole("link", { name: "Maintenance" })).not.toBeVisible();
  334 |   });
  335 | });
  336 | 
  337 | // ---------------------------------------------------------------------------
  338 | // Test 7 (was 6): Admin creates schedule via "New schedule" button on /maintenance
  339 | // ---------------------------------------------------------------------------
  340 | 
  341 | test.describe("Maintenance — new schedule from hub @smoke", () => {
  342 |   let kitId: string;
  343 |   let schedSerial: string;
  344 | 
  345 |   test.beforeAll(async () => {
  346 |     // Clean up any leftover HubCalibration schedules from prior test runs before creating our kit
  347 |     await deleteSchedulesByType("HubCalibration");
  348 | 
  349 |     schedSerial = `${TS}-HUB`;
  350 |     const kit = await createTestKit(schedSerial);
  351 |     kitId = kit.id;
  352 |   });
  353 | 
  354 |   test.afterAll(async () => {
  355 |     // Clean up schedules by type to prevent growth on retry
  356 |     await deleteSchedulesByType("HubCalibration");
  357 |     await deleteKit(kitId);
  358 |   });
  359 | 
  360 |   test("admin clicks 'New schedule' on /maintenance, picks kit, fills form, saves @smoke", async ({ page }) => {
  361 |     await loginAs(page, "admin");
  362 |     await page.goto("/maintenance");
  363 | 
  364 |     // Button must be visible
  365 |     const newScheduleBtn = page.getByRole("button", { name: "New schedule" });
  366 |     await expect(newScheduleBtn).toBeVisible({ timeout: 10_000 });
  367 |     await newScheduleBtn.click();
  368 | 
  369 |     // Dialog opens — wait for the dialog content to be visible
  370 |     const dialogTitle = page.getByText("New Maintenance Schedule");
  371 |     await expect(dialogTitle).toBeVisible({ timeout: 10_000 });
  372 | 
  373 |     // Kit picker present (NewMaintenanceScheduleDialog uses #nsched-kit)
  374 |     const kitSelect = page.locator("#nsched-kit");
  375 |     await expect(kitSelect).toBeVisible();
  376 |     await kitSelect.selectOption({ label: schedSerial });
  377 | 
  378 |     // Fill required fields
  379 |     // Type is a Radix Select in NewMaintenanceScheduleDialog
  380 |     const typeSelect = page.locator("#nsched-type");
  381 |     await expect(typeSelect).toBeVisible();
  382 |     await typeSelect.click();
  383 |     await page.getByRole("option", { name: "Calibration" }).click();
  384 | 
  385 |     // Description is required
  386 |     await page.getByLabel("Description").fill("Hub calibration procedure");
  387 | 
  388 |     // Interval days
  389 |     await page.getByLabel("Interval (days)").fill("45");
  390 | 
  391 |     // Save (NewMaintenanceScheduleDialog uses "Create schedule" button)
  392 |     await page.getByRole("button", { name: "Create schedule" }).last().click();
  393 | 
  394 |     // Success toast
  395 |     await expect(page.locator("div:has-text('Schedule created')").first()).toBeVisible({ timeout: 10_000 });
  396 | 
  397 |     // Schedule appears in the table (scope to tbody to avoid notification/option matches, use first() for strict mode)
  398 |     await expect(page.locator("tbody").getByText("Calibration").first()).toBeVisible({ timeout: 5000 });
  399 |   });
  400 | });
  401 | 
  402 | // ---------------------------------------------------------------------------
  403 | // Test 8: Bulk-apply schedule across multiple kits @smoke (F5)
  404 | // ---------------------------------------------------------------------------
  405 | 
  406 | test.describe("Maintenance — bulk-apply schedule @smoke", () => {
  407 |   const kitIds: string[] = [];
  408 |   const kitSerials: string[] = [];
```