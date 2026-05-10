/**
 * Auth flows: login, logout, redirect guards, role visibility.
 *
 * Actor: admin, user, viewer, unauthenticated
 * Coverage:
 *   - Login page renders correct form elements
 *   - Invalid credentials shows error
 *   - Unauthenticated user redirected to /login
 *   - Happy path login for each role
 *   - Logout clears session and redirects to /login
 *   - Admin sees admin-only buttons; viewer/user do not
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test.describe("Login page", () => {
  test("renders correct form elements", async ({ page }) => {
    await page.goto("/login");
    // Heading on the right panel
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      message: "Login form should appear after redirect",
    });
  });

  test("invalid credentials shows error message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({
      message: "Error message should appear for bad credentials",
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test("admin can log in and reaches dashboard", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("complementary").getByText("logistics@kit.local")).toBeVisible();
  });

  test("user (non-admin) can log in and reaches dashboard", async ({ page }) => {
    await loginAs(page, "user");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("complementary").getByText("requester@kit.local")).toBeVisible();
  });

  test("viewer can log in and reaches dashboard", async ({ page }) => {
    await loginAs(page, "viewer");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("complementary").getByText("viewer@kit.local")).toBeVisible();
  });
});

test.describe("Logout", () => {
  test("logout clears session and redirects to /login", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL("**/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      message: "Should be back on login after logout",
    });
    // Navigating to a protected route should redirect again
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
  });
});

test.describe("Role-based UI visibility — Kits page", () => {
  test("admin sees 'New kit' button", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(page.getByRole("button", { name: /new kit/i })).toBeVisible({
      message: "Admin should see the New kit button",
    });
  });

  test("viewer does not see 'New kit' button", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(page.getByRole("button", { name: /new kit/i })).not.toBeVisible({
      message: "Viewer should not see the New kit button",
    });
  });

  test("user (non-admin) does not see 'New kit' button", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/kits");
    await expect(page.getByRole("heading", { name: "Kits" })).toBeVisible();
    await expect(page.getByRole("button", { name: /new kit/i })).not.toBeVisible({
      message: "User (non-admin) should not see New kit",
    });
  });
});

test.describe("Role-based UI visibility — Entities page", () => {
  test("admin sees 'New entity' button", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("button", { name: /new entity/i })).toBeVisible({
      message: "Admin should see the New entity button",
    });
  });

  test("viewer does not see 'New entity' button", async ({ page }) => {
    await loginAs(page, "viewer");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("button", { name: /new entity/i })).not.toBeVisible({
      message: "Viewer should not see the New entity button",
    });
  });

  test("user (non-admin) does not see 'New entity' button", async ({ page }) => {
    await loginAs(page, "user");
    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entities" })).toBeVisible();
    await expect(page.getByRole("button", { name: /new entity/i })).not.toBeVisible({
      message: "User (non-admin) should not see New entity",
    });
  });
});
