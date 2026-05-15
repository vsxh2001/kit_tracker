/**
 * AI Chat sidebar — Phase 1 tests.
 *
 * Covers:
 *   - Logged-in user clicks floating "Ask AI" button → drawer opens
 *   - Sends a message → assistant reply rendered with markdown
 *   - Backticked record IDs become clickable links
 *   - Rate limit: 429 response shows error toast
 *   - Cost cap: 503 response shows cost cap toast
 *   - "Plumbing only" disclaimer removed
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
    // Phase 1: disclaimer removed — only the Claude subtitle is shown
    await expect(page.getByText(/powered by claude/i)).toBeVisible();
    await expect(page.getByText("Plumbing only — AI replies pending")).not.toBeVisible();
  });

  test("chat drawer closes when X button clicked", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("button", { name: /close ai chat/i }).click();
    await expect(page.getByRole("complementary", { name: /ai chat/i })).not.toBeInViewport();
  });

  test("sends message and receives assistant reply @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    // Stub Anthropic to return a canned response with a record ID
    await page.route("**/api.anthropic.com/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "There are 3 kits. For example kit `abc1234567890de` is at Lab-A." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 }
        }),
      });
    });

    // Stub the PB chat endpoint directly (since PB hook calls Anthropic server-side)
    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "There are 3 kits. For example kit `abc1234567890de` is at Lab-A.",
          sessionId: "test-session",
          done: true,
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("list kits");
    await input.press("Enter");

    // User bubble appears
    await expect(page.getByText("list kits")).toBeVisible();

    // Assistant reply appears
    await expect(page.getByText(/there are 3 kits/i)).toBeVisible({ timeout: 10_000 });
  });

  test("backticked record ID becomes a clickable link @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    // Stub the PB chat endpoint to return a reply with a backticked ID
    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "Kit `abc1234567890de` is at Lab-A since Monday.",
          sessionId: "test-session",
          done: true,
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("where is kit abc?");
    await input.press("Enter");

    // The ID should be rendered as a link
    const link = page.getByRole("link", { name: "abc1234567890de" });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute("href", /\/kits\/abc1234567890de/);
  });

  test("Send button triggers message send", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ reply: "pong", sessionId: "s", done: true }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("ping");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText("pong")).toBeVisible({ timeout: 10_000 });
  });

  test("Shift+Enter adds newline without sending", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /ask ai/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("line1");
    await input.press("Shift+Enter");
    // After Shift+Enter there should be no assistant reply yet (message not sent)
    await expect(page.getByText(/pong/i)).not.toBeVisible();
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

    await expect(page.getByText(/rate limit reached/i).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/try again in 3600 seconds/i).first()).toBeVisible();
  });

  test("cost cap 503 shows daily budget toast", async ({ page }) => {
    await loginAs(page, "admin");

    // Intercept the /api/ai/chat route to return a 503 cost cap
    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "daily_cost_cap", spent_cents: 100, cap_cents: 100 }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("test");
    await input.press("Enter");

    await expect(page.getByText(/daily ai budget reached/i).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/try again tomorrow/i).first()).toBeVisible();
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

  test("POST /api/ai/chat returns a reply", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ message: "integration test" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.reply).toBe("string");
    expect(data.reply.length).toBeGreaterThan(0);
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
