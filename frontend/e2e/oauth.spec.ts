/**
 * Google OAuth sign-in — presence checks and manual flow documentation.
 *
 * Actor: any unauthenticated user
 * Coverage:
 *   - "Sign in with Google" button is visible on the login page
 *   - Adjacent email/password form is also present (OAuth is additive, not replacing)
 *   - Clicking the Google button initiates the OAuth flow (button triggers handler)
 *   - Full interactive sign-in: skipped in automation (Google consent requires
 *     interactive credentials + 2FA that cannot be scripted without stored OAuth tokens)
 *
 * IMPORTANT — server requirement:
 *   These tests must run against the feat-google-oauth branch Vite server (port 5177
 *   by default when the worktree Vite is running alongside the main-branch Vite).
 *   Run with: npx playwright test e2e/oauth.spec.ts --base-url http://localhost:5177
 *   Or set BASE_URL=http://localhost:5177 before running npm run test.
 *
 * PocketBase must have Google OAuth configured:
 *   export GOOGLE_OAUTH_CLIENT_ID=...
 *   export GOOGLE_OAUTH_CLIENT_SECRET=...
 *   bash pb/setup_oauth.sh <superuser-email> <superuser-password>
 *
 * Manual demo procedure (for sign-in completion after the automation stops):
 *   1. Open http://localhost:5177/login in a real browser.
 *   2. Click "Sign in with Google".
 *   3. Complete Google sign-in (email + password + 2FA if enabled).
 *   4. Google redirects to http://127.0.0.1:8090/api/oauth2-redirect which PocketBase
 *      handles and redirects back to the frontend with an auth token.
 *   5. Verify: localStorage key "pocketbase_auth" is populated, page shows /dashboard.
 *   6. Check PocketBase users collection for a new record with your Google email.
 *      Note: new OAuth users get an empty `role` — an admin must assign a role manually.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve login URL — respects BASE_URL env override for worktree testing. */
function loginURL(): string {
  const base = process.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return base ? `${base}/login` : "/login";
}

// ---------------------------------------------------------------------------
// Test: login page shows Sign in with Google button
// ---------------------------------------------------------------------------

test.describe("Google OAuth — login page UI", () => {
  test("login page shows Sign in with Google button", async ({ page }) => {
    await page.goto(loginURL());

    await expect(
      page.getByRole("button", { name: /sign in with google/i }),
      "Google OAuth button must be visible on the login page"
    ).toBeVisible();
  });

  test("Sign in with Google button appears above the email/password form", async ({
    page,
  }) => {
    await page.goto(loginURL());

    const googleBtn = page.getByRole("button", { name: /sign in with google/i });
    const emailInput = page.getByLabel("Email");
    const passwordInput = page.getByLabel("Password");
    const signInBtn = page.getByRole("button", { name: /^sign in$/i });

    await expect(googleBtn, "Google button must be present").toBeVisible();
    await expect(emailInput, "Email field must be present").toBeVisible();
    await expect(passwordInput, "Password field must be present").toBeVisible();
    await expect(signInBtn, "Sign in (password) button must be present").toBeVisible();

    // Google button should appear before (above) the email/password form.
    // Check via DOM order: getByRole returns first match — confirm Google comes first.
    const googleBtnBox = await googleBtn.boundingBox();
    const emailInputBox = await emailInput.boundingBox();
    expect(
      googleBtnBox!.y,
      "Google button should be positioned above the email input"
    ).toBeLessThan(emailInputBox!.y);
  });

  test("divider text separates OAuth from password form", async ({ page }) => {
    await page.goto(loginURL());
    await expect(
      page.getByText(/or continue with email/i),
      "Separator text between OAuth and password form should be visible"
    ).toBeVisible();
  });

  test("clicking Sign in with Google initiates OAuth flow (button is functional)", async ({
    page,
  }) => {
    test.skip(!process.env.GOOGLE_OAUTH_CLIENT_ID, "Google OAuth not configured in this environment");

    await page.goto(loginURL());

    const googleBtn = page.getByRole("button", { name: /sign in with google/i });
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toBeEnabled();

    // In headless mode the OAuth popup/redirect cannot complete — PocketBase will
    // open accounts.google.com but the flow fails without interactive credentials.
    // We verify the button triggers the handler (loading state or error state) rather
    // than doing nothing.
    await googleBtn.click();

    // Race the three possible post-click outcomes. First to resolve wins; if none
    // resolves within 5 s the test fails fast (no 2-second unconditional sleep).
    const TIMEOUT = 5_000;
    const loadingVisible = page.getByText(/signing in/i).waitFor({ state: "visible", timeout: TIMEOUT });
    const errorVisible = page.getByText(/google sign-in failed/i).waitFor({ state: "visible", timeout: TIMEOUT });
    const redirectedToGoogle = page.waitForURL(/accounts\.google\.com/, { timeout: TIMEOUT });

    await Promise.race([loadingVisible, errorVisible, redirectedToGoogle]).catch(() => {
      throw new Error(
        "After clicking Sign in with Google, neither a loading state, error message, nor redirect to Google occurred within 5 s — confirms handler is NOT wired up"
      );
    });
  });

  test("password sign-in still works alongside Google OAuth button", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await expect(page).toHaveURL(/\/dashboard/, {
      message: "Password sign-in should still navigate to dashboard",
    });
  });
});

// ---------------------------------------------------------------------------
// Test: PocketBase exposes Google as an auth provider
// ---------------------------------------------------------------------------

test.describe("Google OAuth — PocketBase configuration", () => {
  test("PocketBase auth-methods endpoint lists Google provider", async ({
    request,
  }) => {
    test.skip(!process.env.GOOGLE_OAUTH_CLIENT_ID, "Google OAuth not configured in this environment");
    const response = await request.get(
      "http://127.0.0.1:8090/api/collections/users/auth-methods"
    );
    expect(response.ok(), "auth-methods endpoint should return 200").toBe(true);

    const body = await response.json();
    const providers: Array<{ name: string }> = body.authProviders ?? [];
    const googleProvider = providers.find((p) => p.name === "google");

    expect(
      googleProvider,
      "Google must be listed as an auth provider in PocketBase"
    ).toBeDefined();
    expect(
      googleProvider!.name,
      "Provider name should be 'google'"
    ).toBe("google");
  });
});

// ---------------------------------------------------------------------------
// Test: Full interactive Google OAuth — SKIPPED in automation
// ---------------------------------------------------------------------------

test.describe("Google OAuth — full sign-in (manual / skipped)", () => {
  /**
   * TODO: This test cannot be automated with standard Playwright because:
   * 1. Google's consent screen requires interactive sign-in (email + password + 2FA).
   * 2. Google's bot-detection blocks headless browsers on the consent page.
   * 3. Storing long-lived Google refresh tokens in CI is a security risk.
   *
   * Manual demo procedure:
   *   1. Ensure PocketBase is running with Google OAuth enabled (setup_oauth.sh).
   *   2. Ensure the feat-google-oauth Vite server is running (port 5177).
   *   3. Open http://localhost:5177/login in Chrome.
   *   4. Click "Sign in with Google".
   *   5. Complete Google consent (choose account → Allow).
   *   6. PocketBase handles the callback at http://127.0.0.1:8090/api/oauth2-redirect.
   *   7. Verify:
   *      - Page navigates to /dashboard.
   *      - localStorage["pocketbase_auth"] contains a valid token.
   *      - PocketBase users collection has a new record with your Google email.
   *      - The new user's `role` field is empty (admin must assign a role).
   *
   * Automation path (future, if needed):
   *   Use Playwright with a pre-seeded Google OAuth token via PocketBase's
   *   POST /api/collections/users/auth-with-oauth2 REST endpoint, passing a
   *   mocked code + code_verifier pair — but this requires a Google OAuth test
   *   account with stored refresh tokens (not viable in standard CI).
   */
  test.skip(
    true,
    "Interactive Google OAuth cannot be automated — see comment above for manual procedure"
  );
  test("new Google OAuth user lands on dashboard and has empty role", async ({
    page,
  }) => {
    // This body is unreachable (test.skip above) but documents the assertions
    // that should be verified manually or via a future token-injection approach.
    await page.goto(loginURL());
    await page.getByRole("button", { name: /sign in with google/i }).click();

    // At this point, user completes Google consent in the browser window.
    // After completion, PocketBase redirects back and the frontend navigates.
    await page.waitForURL("**/dashboard", { timeout: 60_000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify auth token is stored
    const authToken = await page.evaluate(() =>
      localStorage.getItem("pocketbase_auth")
    );
    expect(authToken, "pocketbase_auth token should be in localStorage").not.toBeNull();

    // Verify the user record exists in PocketBase users collection with correct email
    // (checked via PocketBase API using the token from localStorage)
    const tokenData = JSON.parse(authToken!);
    expect(
      tokenData?.record?.email,
      "Auth token should contain the Google account email"
    ).toBeTruthy();

    // New OAuth users get no role — admin must assign one
    expect(
      tokenData?.record?.role ?? "",
      "New OAuth user should have empty role until admin assigns one"
    ).toBe("");
  });
});
