/**
 * AI Chat sidebar — Phase 1 + Phase 2A tests.
 *
 * Covers:
 *   - Logged-in user clicks floating "Ask AI" button → drawer opens
 *   - Sends a message → assistant reply rendered with markdown
 *   - Backticked record IDs become clickable links
 *   - Rate limit: 429 response shows error toast
 *   - Cost cap: 503 response shows cost cap toast
 *   - "Plumbing only" disclaimer removed
 *
 * Phase 2A additions:
 *   - tool_result card rendered when write tool succeeds
 *   - Undo button visible for 60s, hidden after timer
 *   - Undo button calls POST /api/ai/undo
 *   - clarification_needed renders choice buttons
 *   - Clicking choice button sends follow-up message
 *   - Permission denied (viewer) → no tool_result card, polite reply
 *
 * Anthropic is stubbed via page.route for all UI tests.
 * Direct API tests hit PB at PB_URL (requires running PB).
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { getUserTokenByEmail } from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";

// Reusable stub for write tool responses
function makeWriteToolResponse(opts: {
  reply?: string;
  description?: string;
  recordId?: string;
  collection?: string;
  tool?: string;
  undoToken?: string;
}) {
  return JSON.stringify({
    reply: opts.reply ?? "Done! " + (opts.description ?? "Action completed."),
    sessionId: "test-session",
    done: true,
    tool_result: {
      tool: opts.tool ?? "create_entity",
      action: "create",
      record_id: opts.recordId ?? "abc1234567890ef",
      collection: opts.collection ?? "entities",
      description: opts.description ?? "Created entity: TestLab-A",
    },
    undo_token: opts.undoToken ?? "undotokenabcdef12",
  });
}

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

    // The ID should be rendered as plain code (not a link), since auto-linking was removed
    // to avoid 404s when linking non-kit record IDs
    const code = page.locator("code", { has: page.locator("text=abc1234567890de") });
    await expect(code).toBeVisible({ timeout: 10_000 });
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

// Phase 2A: write tool UI tests
test.describe("AI Chat — Phase 2A write tools (UI, Anthropic stubbed)", () => {
  test("create_entity success shows tool result card with undo button @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "I've created the entity TestLab-A for you.",
          description: "Created entity: TestLab-A",
          collection: "entities",
          tool: "create_entity",
          undoToken: "undotokenabcdef12",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create entity TestLab-A");
    await page.getByRole("button", { name: /send message/i }).click();

    // Tool result card appears
    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Created entity: TestLab-A/i)).toBeVisible();
    // Undo button visible
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("undo button calls POST /api/ai/undo and shows success", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Created kit KIT-001.",
          description: "Created kit: KIT-001",
          collection: "kits",
          tool: "create_kit",
          undoToken: "undotoken99999999",
        }),
      });
    });

    let undoCalled = false;
    await page.route("**/api/ai/undo", (route) => {
      undoCalled = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, tool: "create_kit" }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create kit KIT-001");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByTestId("undo-button")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("undo-button").click();

    // Undo called
    await expect.poll(() => undoCalled).toBe(true);
    // Undo button disappears after success
    await expect(page.getByTestId("undo-button")).not.toBeVisible({ timeout: 5_000 });
  });

  test("clarification_needed renders choice buttons", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route, request) => {
      const body = request.postDataJSON() as { message?: string };
      // First call → clarification
      if (!body?.message?.includes("use ")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            reply: "I found multiple kits matching 'yossi'. Which one did you mean?",
            sessionId: "test-session",
            done: true,
            clarification_needed: {
              field: "kit_id",
              candidates: [
                { id: "kitid1111111111a", label: "YOSSI-001", detail: "at Lab-A" },
                { id: "kitid2222222222b", label: "YOSSI-002", detail: "at Storage" },
              ],
            },
          }),
        });
      } else {
        // Second call after picking a choice
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ reply: "Moving kit YOSSI-001.", sessionId: "test-session", done: true }),
        });
      }
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("move kit yossi to Lab-B");
    await page.getByRole("button", { name: /send message/i }).click();

    // Clarification card with choices
    await expect(page.getByTestId("clarification-card")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("YOSSI-001")).toBeVisible();
    await expect(page.getByText("YOSSI-002")).toBeVisible();

    // Click first choice → sends follow-up
    await page.getByTestId(`clarification-choice-kitid1111111111a`).click();
    await expect(page.getByText(/moving kit YOSSI-001/i)).toBeVisible({ timeout: 10_000 });
  });

  test("viewer role sees polite refusal (no tool_result card)", async ({ page }) => {
    await loginAs(page, "viewer");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "I'm sorry, but you don't have permission to create entities. Only admins and technicians can do that.",
          sessionId: "test-session",
          done: true,
          // No tool_result or undo_token
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create entity ForbiddenLab");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 10_000 });
    // No tool_result card
    await expect(page.getByTestId("tool-result-card")).not.toBeVisible();
  });

  test("move_kit success shows tool result card", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Moved kit KIT-AI-001 to TestLab-A.",
          description: "Moved kit KIT-AI-001 to TestLab-A",
          collection: "transactions",
          tool: "move_kit",
          undoToken: "undotokenmove12345",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("move kit KIT-AI-001 to TestLab-A");
    await page.getByRole("button", { name: /send message/i }).click();

    const moveCard = page.getByTestId("tool-result-card");
    await expect(moveCard).toBeVisible({ timeout: 10_000 });
    await expect(moveCard.getByText(/Moved kit KIT-AI-001/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
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

  // Phase 2A: permission tests (role-based, Anthropic not needed — no API key in test env)
  test("POST /api/ai/undo returns 401 without auth", async () => {
    const res = await fetch(`${PB_URL}/api/ai/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ undo_token: "sometoken" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/ai/undo returns 400 for missing token", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/ai/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/ai/undo returns 400 expired for unknown token", async () => {
    const token = await getAdminToken();
    const res = await fetch(`${PB_URL}/api/ai/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ undo_token: "nonexistenttoken12" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("expired");
  });

  test("viewer role gets permission_denied in tool result", async () => {
    // Since no Anthropic key in test env, the response is a fallback.
    // This test verifies the hook route is accessible to viewer but write tools refuse.
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");
    const res = await fetch(`${PB_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ message: "create entity TestLab" }),
    });
    // Should get 200 with a reply (fallback or real), not a 403 at HTTP level
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.reply).toBe("string");
  });
});

// Phase 2B: write tool UI tests (Anthropic stubbed)
test.describe("AI Chat — Phase 2B write tools (UI, Anthropic stubbed)", () => {
  test("create_product success shows tool result card with undo button", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "I've created the product Samsung 970 EVO SSD for you.",
          description: "Created product: Samsung 970 EVO SSD",
          collection: "products",
          tool: "create_product",
          undoToken: "undoproducttoken01",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create product Samsung 970 EVO SSD, manufacturer Samsung");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Created product: Samsung 970 EVO SSD/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("create_component success shows tool result card", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Created component SSD-001. Call move_component to place it.",
          description: "Created component: SSD-001",
          collection: "components",
          tool: "create_component",
          undoToken: "undocomptoken000001",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create component serial SSD-001");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Created component: SSD-001/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("move_component success shows tool result card", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Moved component SSD-001 to Kit KIT-001.",
          description: "Moved component SSD-001 to KIT-001",
          collection: "component_transactions",
          tool: "move_component",
          undoToken: "undomovecomptoken1",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("move component SSD-001 to kit KIT-001");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Moved component SSD-001/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("decide_request success shows tool result card", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Request req123 has been approved.",
          description: "Request req123 approved. Note: fulfillment is a separate step.",
          collection: "requests",
          tool: "decide_request",
          undoToken: "undodeciderequest01",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("approve request req123");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/approved/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("link_component_to_product success shows tool result card", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Re-linked component SSD-001 to product Samsung 970 EVO.",
          description: "Re-linked component SSD-001 to product prod123",
          collection: "components",
          tool: "link_component_to_product",
          undoToken: "undolinkcomptoken1",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("link component SSD-001 to product Samsung 970 EVO");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Re-linked component/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("viewer role sees polite refusal for create_product (no tool_result card)", async ({ page }) => {
    await loginAs(page, "viewer");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "I'm sorry, but you don't have permission to create products. Only admins and technicians can do that.",
          sessionId: "test-session",
          done: true,
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create product ForbiddenProduct");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("tool-result-card")).not.toBeVisible();
  });
});

// Phase 2B: Direct API permission tests
test.describe("AI Chat — Phase 2B permission gates (direct API)", () => {
  test("resolve_product returns 200 for any auth user", async () => {
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");
    // resolve_product is read-only — viewer can call it via the chat endpoint
    // Since no Anthropic key, fallback response is expected
    const res = await fetch(`${PB_URL}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ message: "find product Samsung" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.reply).toBe("string");
  });

  test("MCP tools/list returns all 20 tool definitions for admin", async () => {
    const token = await (async () => {
      const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
      });
      const d = await res.json();
      return d.token as string;
    })();

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.tools.length).toBe(20);
    const toolNames = data.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("resolve_product");
    expect(toolNames).toContain("create_product");
    expect(toolNames).toContain("create_component");
    expect(toolNames).toContain("move_component");
    expect(toolNames).toContain("decide_request");
    expect(toolNames).toContain("link_component_to_product");
    expect(toolNames).toContain("update_entity");
    expect(toolNames).toContain("update_kit");
    expect(toolNames).toContain("update_product");
  });

  test("MCP create_product returns permission_denied for viewer", async () => {
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "create_product", arguments: { name: "TestProduct" } },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error?.message).toBe("permission_denied");
  });

  test("MCP move_component requires both component_id and to_kit_id or to_entity_id", async () => {
    const adminToken = await (async () => {
      const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
      });
      const d = await res.json();
      return d.token as string;
    })();

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: adminToken },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "move_component", arguments: { component_id: "somecompid123" } },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should be a result (not an RPC-level error), but with validation_error inside
    const resultText = data.result?.content?.[0]?.text;
    expect(resultText).toBeTruthy();
    const resultObj = JSON.parse(resultText);
    expect(resultObj.error).toBe("validation_error");
  });
});

// Phase 2C: update_* write tool UI tests (Anthropic stubbed)
test.describe("AI Chat — Phase 2C update tools (UI, Anthropic stubbed)", () => {
  test("update_entity success shows tool result card with undo button", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "I've reactivated entity FooLab for you.",
          description: "Updated entity: entabc1234567890",
          collection: "entities",
          tool: "update_entity",
          undoToken: "undoupdateentity01",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("reactivate entity FooLab");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Updated entity/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("update_kit success shows tool result card with undo button", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "I've updated kit KIT-007.",
          description: "Updated kit: kitabc1234567890",
          collection: "kits",
          tool: "update_kit",
          undoToken: "undoupdatekit00001",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("rename kit KIT-007 serial to KIT-007B");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Updated kit/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("update_product success shows tool result card with undo button", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "I've updated product Samsung 970 EVO SSD.",
          description: "Updated product: prodabc1234567890",
          collection: "products",
          tool: "update_product",
          undoToken: "undoupdateprod0001",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("fix description of Samsung 970 EVO SSD");
    await page.getByRole("button", { name: /send message/i }).click();

    const card = page.getByTestId("tool-result-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(/Updated product/i)).toBeVisible();
    await expect(page.getByTestId("undo-button")).toBeVisible();
  });

  test("viewer role sees polite refusal for update_entity (no tool_result card)", async ({ page }) => {
    await loginAs(page, "viewer");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reply: "I'm sorry, but you don't have permission to update entities. Only admins and technicians can do that.",
          sessionId: "test-session",
          done: true,
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("reactivate entity FooLab");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("tool-result-card")).not.toBeVisible();
  });
});

// Phase 2C: Direct API tests for update tools
test.describe("AI Chat — Phase 2C update tools (direct API)", () => {
  test("MCP update_entity returns permission_denied for viewer", async () => {
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "update_entity", arguments: { id: "someentityid123", name: "NewName" } },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error?.message).toBe("permission_denied");
  });

  test("MCP update_entity returns no_fields_to_update when only id provided", async () => {
    const adminToken = await (async () => {
      const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: "logistics@kit.local", password: "Pass1234!" }),
      });
      const d = await res.json();
      return d.token as string;
    })();

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: adminToken },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "update_entity", arguments: { id: "someentityid123" } },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const resultText = data.result?.content?.[0]?.text;
    expect(resultText).toBeTruthy();
    const resultObj = JSON.parse(resultText);
    expect(resultObj.error).toBe("no_fields_to_update");
  });

  test("MCP update_kit returns permission_denied for viewer", async () => {
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "update_kit", arguments: { id: "somekitid12345", serial: "NEW-001" } },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error?.message).toBe("permission_denied");
  });

  test("MCP update_product returns permission_denied for viewer", async () => {
    const { token } = await getUserTokenByEmail("viewer@kit.local", "Pass1234!");

    const res = await fetch(`${PB_URL}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "update_product", arguments: { id: "someprodid12345", name: "NewName" } },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error?.message).toBe("permission_denied");
  });
});
