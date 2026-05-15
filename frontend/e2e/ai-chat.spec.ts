/**
 * AI Chat sidebar — Phase 0 smoke tests.
 *
 * Covers:
 *   - Logged-in user clicks floating "Ask AI" button → drawer opens
 *   - Types "hello" + sends → assistant echo message appears
 *   - Rate limit: 429 response shows error toast
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

test.describe("AI Chat sidebar", () => {
  test("floating button is visible after login @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page.getByRole("button", { name: /ask ai/i })).toBeVisible();
  });

  test("clicking Ask AI opens the chat drawer @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();
    await expect(page.getByRole("complementary", { name: /ai chat/i })).toBeVisible();
    await expect(page.getByText("Plumbing only — AI replies pending")).toBeVisible();
  });

  test("chat drawer closes when X button clicked", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("button", { name: /close ai chat/i }).click();
    await expect(page.getByRole("complementary", { name: /ai chat/i })).not.toBeInViewport();
  });

  test("sends message and receives echo reply @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("hello");
    await input.press("Enter");

    // User bubble appears
    await expect(page.getByText("hello")).toBeVisible();

    // Echo reply appears (Phase 0 stub)
    await expect(
      page.getByText(/you said: hello\. \(ai not wired yet/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Send button triggers message send", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();

    await page.getByRole("textbox", { name: /chat message input/i }).fill("ping");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText(/you said: ping/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Shift+Enter adds newline without sending", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("line1");
    await input.press("Shift+Enter");
    // After Shift+Enter there should be no assistant reply yet (message not sent)
    await expect(page.getByText(/you said: line1/i)).not.toBeVisible();
  });

  test("rate limit 429 shows error toast", async ({ page }) => {
    await loginAs(page, "admin");

    // Intercept the /api/ai/chat route to return a 429
    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "rate_limit", retry_after_seconds: 3600 }),
        headers: { "Retry-After": "3600" },
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("test");
    await input.press("Enter");

    await expect(page.getByText(/rate limit reached/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/try again in 3600 seconds/i)).toBeVisible();
  });
});

// Direct API test — verifies the PB hook responds correctly
test.describe("AI Chat API (direct)", () => {
  async function getAdminToken(): Promise<string> {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
    });
    const data = await res.json();
    return data.token as string;
  }

  test("POST /api/ai/chat returns echo reply", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ message: "integration test" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reply).toContain("You said: integration test");
    expect(data.done).toBe(true);
  });

  test("POST /api/ai/chat returns 401 without auth", async () => {
    const res = await fetch(`${PB_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/ai/chat returns 400 without message", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
