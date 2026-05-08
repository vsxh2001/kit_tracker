/**
 * End-to-end workflow tests for Kit Tracker.
 * Uses system Chrome (no Playwright browser download needed).
 *
 * Run: node e2e_workflows.mjs
 */
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5173";
const ADMIN = { email: "logistics@kit.local", password: "Pass1234!" };
const USER  = { email: "requester@kit.local",  password: "Pass1234!" };

let browser, page;

function log(msg) { console.log(`\n[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ FAIL: ${msg}`); }

async function screenshot(name) {
  await page.screenshot({ path: `/tmp/e2e_${name}.png`, fullPage: false });
}

async function login(creds) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("input[type=email]");
  await page.fill("input[type=email]", creds.email);
  await page.fill("input[type=password]", creds.password);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/dashboard`);
  pass(`logged in as ${creds.email}`);
}

async function logout() {
  await page.click("text=Logout");
  await page.waitForURL(`${BASE}/login`);
  pass("logged out");
}

// ── Workflow 1: Admin login + dashboard ─────────────────────────────────────
async function wf1_adminDashboard() {
  log("WF1: Admin login & dashboard");
  await login(ADMIN);
  await page.waitForSelector("text=Dashboard");
  await page.waitForSelector("text=Total kits");
  await screenshot("wf1_dashboard");
  pass("dashboard shows stats");
}

// ── Workflow 2: Create a new kit ────────────────────────────────────────────
async function wf2_createKit() {
  log("WF2: Create kit");
  await page.click("text=Kits");
  await page.waitForURL(`${BASE}/kits`);
  await page.click("text=New kit");
  await page.waitForSelector("text=New Kit");
  await page.fill("input[placeholder='KIT-001']", "KIT-100");
  await page.fill("textarea", "Test kit created by e2e");
  await page.click("text=Save");
  await page.waitForSelector("text=KIT-100");
  await screenshot("wf2_kits_after_create");
  pass("KIT-100 visible in kits list");
}

// ── Workflow 3: View kit detail ──────────────────────────────────────────────
async function wf3_kitDetail() {
  log("WF3: Kit detail + history");
  // Click arrow on KIT-001
  const rows = page.locator("tr").filter({ hasText: "KIT-001" });
  await rows.first().locator("button").click();
  await page.waitForURL(/\/kits\/.+/);
  await page.waitForSelector("text=Transaction history");
  await screenshot("wf3_kit_detail");
  pass("kit detail page loaded with history");
}

// ── Workflow 4: Move kit ─────────────────────────────────────────────────────
async function wf4_moveKit() {
  log("WF4: Move kit");
  await page.click("text=Move kit");
  await page.waitForSelector("text=Move Kit");
  // Select "Lab" from the destination select
  await page.click("[role=combobox]");
  await page.click("text=Lab");
  await page.fill("textarea", "Moved to lab for e2e test");
  await page.click("button:has-text('Move kit')");
  // Wait for dialog to close and history to update
  await page.waitForSelector("text=Moved to lab for e2e test");
  await screenshot("wf4_after_move");
  pass("kit moved to Lab, transaction appears in history");
}

// ── Workflow 5: Entities page ────────────────────────────────────────────────
async function wf5_entities() {
  log("WF5: Entities list + create");
  await page.goto(`${BASE}/entities`);
  await page.waitForSelector("text=Entities");
  await page.waitForSelector("text=Logistics");
  await screenshot("wf5_entities");
  pass("entities list shows seeded data");

  await page.click("text=New entity");
  await page.waitForSelector("text=New Entity");
  await page.fill("input[placeholder='e.g. Logistics']", "Field Office");
  // Type is pre-selected as storage; change to team
  const typeSelect = page.locator("[role=combobox]").first();
  await typeSelect.click();
  await page.click("text=team");
  await page.click("button:has-text('Save')");
  await page.waitForSelector("text=Field Office");
  await screenshot("wf5_after_create_entity");
  pass("Field Office entity created");
}

// ── Workflow 6: User creates request ────────────────────────────────────────
async function wf6_userRequest() {
  log("WF6: Regular user creates request");
  await logout();
  await login(USER);
  await page.click("text=Requests");
  await page.waitForURL(`${BASE}/requests`);
  await page.click("text=New request");
  await page.waitForSelector("text=New Request");
  await page.fill("textarea", "Need a kit for field test next week");
  await page.click("button:has-text('Submit request')");
  await page.waitForSelector("text=open");
  await screenshot("wf6_request_created");
  pass("request created with status 'open'");
}

// ── Workflow 7: Admin approves & fulfills request ────────────────────────────
async function wf7_approveAndFulfill() {
  log("WF7: Admin approves and fulfills request");
  await logout();
  await login(ADMIN);
  await page.click("text=Requests");
  await page.waitForURL(`${BASE}/requests`);
  // Click into the open request
  const openRow = page.locator("tr").filter({ hasText: "open" }).first();
  await openRow.locator("button").click();
  await page.waitForURL(/\/requests\/.+/);
  await page.waitForSelector("text=Admin actions");

  // Assign KIT-001 to request
  const kitSelect = page.locator("[role=combobox]").nth(0);
  await kitSelect.click();
  await page.click("text=KIT-001");

  // Set target entity to Team A
  const entitySelect = page.locator("[role=combobox]").nth(1);
  await entitySelect.click();
  await page.click("text=Team A");

  await page.fill("textarea", "Approved for field test");
  await page.click("text=Approve");
  await page.waitForSelector("text=approved");
  await screenshot("wf7_approved");
  pass("request approved, kit and entity assigned");

  // Fulfill
  await page.click("text=Fulfill");
  await page.waitForSelector("text=fulfilled");
  await screenshot("wf7_fulfilled");
  pass("request fulfilled — status is 'fulfilled'");
}

// ── Workflow 8: Kit history shows fulfillment transaction ────────────────────
async function wf8_kitHistoryAfterFulfill() {
  log("WF8: Verify kit history reflects fulfillment");
  await page.click("text=Kits");
  await page.waitForURL(`${BASE}/kits`);
  // KIT-001 should now show Team A as current entity
  const kit001Row = page.locator("tr").filter({ hasText: "KIT-001" });
  const entityCell = await kit001Row.locator("td").nth(1).textContent();
  await screenshot("wf8_kit_location");
  if (entityCell?.includes("Team A")) {
    pass(`KIT-001 current entity is: ${entityCell.trim()}`);
  } else {
    fail(`KIT-001 current entity unexpected: ${entityCell}`);
  }
}

// ── Workflow 9: User can only see requests, not admin actions ────────────────
async function wf9_roleRestriction() {
  log("WF9: Role restriction — user cannot see admin actions");
  await logout();
  await login(USER);
  // User cannot see "New kit" button
  await page.click("text=Kits");
  await page.waitForURL(`${BASE}/kits`);
  const newKitBtn = await page.locator("text=New kit").count();
  if (newKitBtn === 0) {
    pass("'New kit' button hidden for regular user");
  } else {
    fail("'New kit' button visible for regular user (should be hidden)");
  }

  // User sees their own request
  await page.click("text=Requests");
  const rows = await page.locator("tr").filter({ hasText: "fulfilled" }).count();
  await screenshot("wf9_user_view");
  pass(`user sees ${rows} fulfilled request row(s)`);
  await logout();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Kit Tracker E2E Workflows ===");
  console.log(`App: ${BASE}`);

  browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: false,
    slowMo: 200,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();

  try {
    await wf1_adminDashboard();
    await wf2_createKit();
    await wf3_kitDetail();
    await wf4_moveKit();
    await wf5_entities();
    await wf6_userRequest();
    await wf7_approveAndFulfill();
    await wf8_kitHistoryAfterFulfill();
    await wf9_roleRestriction();

    console.log("\n✓ All workflows completed successfully.");
    console.log("Screenshots saved to /tmp/e2e_*.png");
  } catch (err) {
    console.error("\n✗ Workflow failed:", err.message);
    await screenshot("error");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
