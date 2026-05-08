import type { Page } from "@playwright/test";

export type Role = "admin" | "user" | "viewer";

const CREDENTIALS: Record<Role, { email: string; password: string }> = {
  admin: { email: "logistics@kit.local", password: "Pass1234!" },
  user: { email: "requester@kit.local", password: "Pass1234!" },
  viewer: { email: "viewer@kit.local", password: "Pass1234!" },
};

/**
 * Log in via the UI login form and wait for navigation to /dashboard.
 * Uses the real login page — no storageState shortcut — so auth flow is
 * tested as part of the session setup.
 */
export async function loginAs(page: Page, role: Role): Promise<void> {
  const { email, password } = CREDENTIALS[role];

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait until the dashboard loads (redirected from /login)
  await page.waitForURL("**/dashboard", { timeout: 10_000 });
}

export { CREDENTIALS };
