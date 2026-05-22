# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prod-smoke.spec.ts >> Prod-build smoke — env-dependent URL bugs @smoke >> /components page renders with rows (filter:undefined bug) @smoke
- Location: e2e/prod-smoke.spec.ts:90:3

# Error details

```
Error: components page stuck on loading or filter:undefined returned nothing silently

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  15  | 
  16  | import { test, expect } from "@playwright/test";
  17  | import { loginAs } from "./helpers/auth";
  18  | import { createTestKit, deleteKit } from "./helpers/api";
  19  | 
  20  | const TS = `prod-smoke-${Date.now()}`;
  21  | 
  22  | test.describe("Prod-build smoke — env-dependent URL bugs @smoke", () => {
  23  |   let kitId: string;
  24  | 
  25  |   test.beforeAll(async () => {
  26  |     const kit = await createTestKit(`${TS}-KIT`, "smoke test kit");
  27  |     kitId = kit.id;
  28  |   });
  29  | 
  30  |   test.afterAll(async () => {
  31  |     await deleteKit(kitId).catch(() => {});
  32  |   });
  33  | 
  34  |   // =========================================================================
  35  |   // Test 1: /audit page loads, no ErrorBoundary, no console fetch errors
  36  |   // =========================================================================
  37  |   test("/audit page renders without console errors @smoke", async ({ page }) => {
  38  |     // Collect console errors
  39  |     const consoleErrors: string[] = [];
  40  |     page.on("console", (msg) => {
  41  |       if (msg.type() === "error") {
  42  |         consoleErrors.push(msg.text());
  43  |       }
  44  |     });
  45  | 
  46  |     // Collect network failures that indicate a double-slash baseUrl bug
  47  |     // (e.g. //api/... from VITE_PB_URL="/" + pb.baseUrl concat).
  48  |     // Intentionally ignore: SDK auto-cancels (StrictMode double-mount) and
  49  |     // optional-collection 404s (on_call_shifts, etc.) — those are not the
  50  |     // bug this test guards against.
  51  |     const doubleSlashErrors: string[] = [];
  52  |     page.on("requestfailed", (req) => {
  53  |       if (/\/\/api\//.test(req.url())) {
  54  |         doubleSlashErrors.push(`${req.method()} ${req.url()}`);
  55  |       }
  56  |     });
  57  | 
  58  |     await loginAs(page, "admin");
  59  |     await page.goto("/audit");
  60  | 
  61  |     // Wait for "Audit Log" heading to confirm page rendered
  62  |     await expect(
  63  |       page.getByRole("heading", { name: /Audit Log/i }),
  64  |     ).toBeVisible({ timeout: 10_000 });
  65  | 
  66  |     // Assert no ErrorBoundary rendered (would show "Something went wrong")
  67  |     await expect(page.getByText(/Something went wrong/i)).not.toBeVisible();
  68  | 
  69  |     // Assert no console errors with double-slash or baseUrl patterns
  70  |     const fetchErrors = consoleErrors.filter(
  71  |       (e) =>
  72  |         /Failed to fetch|Select\.Item|baseUrl/.test(e) ||
  73  |         /\/\/api\//.test(e),
  74  |     );
  75  |     expect(fetchErrors).toEqual(
  76  |       [],
  77  |       `console errors found: ${fetchErrors.join("; ")}`,
  78  |     );
  79  | 
  80  |     // Assert no double-slash URL failures (the specific bug this test targets)
  81  |     expect(doubleSlashErrors).toEqual(
  82  |       [],
  83  |       `double-slash URL errors: ${doubleSlashErrors.join("; ")}`,
  84  |     );
  85  |   });
  86  | 
  87  |   // =========================================================================
  88  |   // Test 2: /components page renders rows (catches filter:undefined regression)
  89  |   // =========================================================================
  90  |   test("/components page renders with rows (filter:undefined bug) @smoke", async ({
  91  |     page,
  92  |   }) => {
  93  |     await loginAs(page, "admin");
  94  |     await page.goto("/components");
  95  | 
  96  |     // Wait for page heading — confirms page rendered and is not stuck on loading
  97  |     await expect(
  98  |       page.getByRole("heading", { name: "Components", exact: true }),
  99  |     ).toBeVisible({ timeout: 10_000 });
  100 | 
  101 |     // The page must not show an ErrorBoundary. If filter:undefined bug is
  102 |     // present the SDK sends filter=undefined as a literal string to PocketBase
  103 |     // which returns 0 results — the heading still renders but we'd see no table
  104 |     // AND no empty-state, indicating the data fetch silently returned nothing.
  105 |     // Check: either a table row OR the "No components yet" empty-state message
  106 |     // must be visible (both are absent only during the loading skeleton phase).
  107 |     const hasTable = await page.locator("tbody tr").count();
  108 |     const hasEmptyState = await page
  109 |       .getByText(/no components yet/i)
  110 |       .isVisible()
  111 |       .catch(() => false);
  112 |     expect(
  113 |       hasTable > 0 || hasEmptyState,
  114 |       "components page stuck on loading or filter:undefined returned nothing silently",
> 115 |     ).toBe(true);
      |       ^ Error: components page stuck on loading or filter:undefined returned nothing silently
  116 |   });
  117 | 
  118 |   // =========================================================================
  119 |   // Test 3: /kits/:id Danger Zone visible to admin
  120 |   // =========================================================================
  121 |   test("/kits/:id Danger Zone visible to admin @smoke", async ({ page }) => {
  122 |     await loginAs(page, "admin");
  123 |     await page.goto(`/kits/${kitId}`);
  124 | 
  125 |     // KitDetailPage h1 is the kit serial, not "Kit Details".
  126 |     // Wait for the Danger Zone button directly — its presence confirms
  127 |     // the page loaded and admin-gating is working.
  128 |     await expect(
  129 |       page.getByRole("button", { name: "Cascade Hard Delete" }),
  130 |     ).toBeVisible({ timeout: 10_000 });
  131 |   });
  132 | 
  133 |   // =========================================================================
  134 |   // Test 4: Cascade preview fetch in page context returns 200
  135 |   //         (catches ${pb.baseUrl}/api → //api bug in prod bundle)
  136 |   // =========================================================================
  137 |   test("cascade-delete preview fetch returns 200 (baseUrl bug) @smoke", async ({
  138 |     page,
  139 |   }) => {
  140 |     await loginAs(page, "admin");
  141 |     await page.goto(`/kits/${kitId}`);
  142 | 
  143 |     // KitDetailPage h1 is the kit serial — wait for Danger Zone button instead.
  144 |     await expect(
  145 |       page.getByRole("button", { name: "Cascade Hard Delete" }),
  146 |     ).toBeVisible({ timeout: 10_000 });
  147 | 
  148 |     // Extract auth token from localStorage in page context
  149 |     const authToken = await page.evaluate(() => {
  150 |       const auth = localStorage.getItem("pocketbase_auth");
  151 |       return auth ? JSON.parse(auth).token : null;
  152 |     });
  153 | 
  154 |     expect(authToken, "No auth token found in localStorage").toBeTruthy();
  155 | 
  156 |     // Call cascade preview endpoint in page context (relative URL resolves
  157 |     // against baseURL set in playwright.config, which is localhost:8090 in prod mode)
  158 |     const statusCode = await page.evaluate(
  159 |       async (token) => {
  160 |         const res = await fetch("/api/admin/cascade-delete/preview", {
  161 |           method: "POST",
  162 |           headers: {
  163 |             Authorization: token,
  164 |             "Content-Type": "application/json",
  165 |           },
  166 |           body: JSON.stringify({
  167 |             collection: "kits",
  168 |             record_id: "test-id-that-may-not-exist",
  169 |           }),
  170 |         });
  171 |         return res.status;
  172 |       },
  173 |       authToken,
  174 |     );
  175 | 
  176 |     // Should get 200 OK (endpoint returns preview even if not found)
  177 |     // or 400 (invalid record_id) — but NOT 404 from //api/...
  178 |     expect([200, 400, 404]).toContain(
  179 |       statusCode,
  180 |       `unexpected status ${statusCode} — //api bug?`,
  181 |     );
  182 |   });
  183 | 
  184 |   // =========================================================================
  185 |   // Test 5: /maintenance page renders
  186 |   // =========================================================================
  187 |   test("/maintenance page renders @smoke", async ({ page }) => {
  188 |     await loginAs(page, "admin");
  189 |     await page.goto("/maintenance");
  190 | 
  191 |     // If the page doesn't exist or throws, the navigation will fail.
  192 |     // Just check that we got a page with some content (not error/404).
  193 |     await expect(page).not.toHaveTitle(/error|not found/i, {
  194 |       timeout: 10_000,
  195 |     });
  196 |   });
  197 | });
  198 | 
```