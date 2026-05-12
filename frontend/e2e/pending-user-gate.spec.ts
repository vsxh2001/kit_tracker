/**
 * pending-user-gate.spec.ts
 *
 * Verifies that pending users (role="") are gated to /dashboard only.
 * All other routes redirect to /dashboard for pending users.
 *
 * Requires: PB running on $PB_URL + Vite on $PLAYWRIGHT_TEST_BASE_URL.
 */

import { test, expect } from "@playwright/test";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
  });
  if (!res.ok) throw new Error(`Admin auth failed: ${res.status}`);
  const data = await res.json();
  return data.token as string;
}

async function createPendingUser(email: string): Promise<{ id: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Pass1234!",
      passwordConfirm: "Pass1234!",
      role: "",
      emailVisibility: true,
    }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`createPendingUser failed: ${JSON.stringify(body)}`);
  }
  return res.json() as Promise<{ id: string }>;
}

async function deletePendingUser(id: string): Promise<void> {
  const token = await getAdminToken();
  await fetch(`${PB_URL}/api/collections/users/records/${id}`, {
    method: "DELETE",
    headers: { Authorization: token },
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

let pendingUserId = "";
const PENDING_EMAIL = `pending-gate-${Date.now()}@test.local`;
const PENDING_PASSWORD = "Pass1234!";

test.beforeAll(async () => {
  const user = await createPendingUser(PENDING_EMAIL);
  pendingUserId = user.id;
});

test.afterAll(async () => {
  if (pendingUserId) await deletePendingUser(pendingUserId);
});

// ---------------------------------------------------------------------------
// Login helper for pending user
// ---------------------------------------------------------------------------

async function loginAsPending(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(PENDING_EMAIL);
  await page.getByLabel("Password").fill(PENDING_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 12_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("pending user lands on /dashboard, sees awaiting banner, no data nav links @smoke", async ({ page }) => {
  await loginAsPending(page);

  // Must be on /dashboard
  await expect(page).toHaveURL(/dashboard/);

  // Awaiting approval banner visible
  await expect(
    page.getByText(/awaiting admin approval/i)
  ).toBeVisible();

  // No data nav links visible
  await expect(page.getByRole("link", { name: /^kits$/i })).not.toBeVisible();
  await expect(page.getByRole("link", { name: /^entities$/i })).not.toBeVisible();
  await expect(page.getByRole("link", { name: /^requests$/i })).not.toBeVisible();
  await expect(page.getByRole("link", { name: /^components$/i })).not.toBeVisible();
  await expect(page.getByRole("link", { name: /^users$/i })).not.toBeVisible();
  await expect(page.getByRole("link", { name: /^audit$/i })).not.toBeVisible();
});

test("pending user direct-nav to /kits redirects to /dashboard", async ({ page }) => {
  await loginAsPending(page);
  await page.goto("/kits");
  await page.waitForURL("**/dashboard", { timeout: 8_000 });
  await expect(page).toHaveURL(/dashboard/);
});

test("pending user direct-nav to /audit redirects to /dashboard", async ({ page }) => {
  await loginAsPending(page);
  await page.goto("/audit");
  await page.waitForURL("**/dashboard", { timeout: 8_000 });
  await expect(page).toHaveURL(/dashboard/);
});
