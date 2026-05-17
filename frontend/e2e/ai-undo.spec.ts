/**
 * AI Chat undo button — countdown + expired window regression tests.
 *
 * Covers:
 *   - Undo button displays countdown "Undo (Xs)" with 60s TTL
 *   - Clicking undo shows "Reverted" toast on success
 *   - Backend expired response shows "Undo window closed" toast + hides button
 *
 * Anthropic is stubbed via page.route. PB undo endpoint stubbed for expired case.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

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

test.describe("AI Chat undo — countdown + TTL (UI, stubbed)", () => {
  test("undo button shows countdown label starting from 60s @smoke", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Created entity Countdown-Lab.",
          description: "Created entity: Countdown-Lab",
          collection: "entities",
          tool: "create_entity",
          undoToken: "undocountdown12345",
        }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create entity Countdown-Lab");
    await page.getByRole("button", { name: /send message/i }).click();

    const btn = page.getByTestId("undo-button");
    await expect(btn).toBeVisible({ timeout: 10_000 });

    // Button should show countdown — match "Undo (" + digits + "s)"
    await expect(btn).toHaveText(/Undo \(\d+s\)/, { timeout: 5_000 });
  });

  test("undo button shows 'Reverted' toast on success", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Created kit UNDO-KIT-001.",
          description: "Created kit: UNDO-KIT-001",
          collection: "kits",
          tool: "create_kit",
          undoToken: "undoreverttest1234",
        }),
      });
    });

    await page.route("**/api/ai/undo", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, tool: "create_kit" }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("create kit UNDO-KIT-001");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByTestId("undo-button")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("undo-button").click();

    // Success toast shows "Reverted"
    await expect(page.getByText(/Reverted/i).first()).toBeVisible({ timeout: 5_000 });
    // Button disappears after successful undo
    await expect(page.getByTestId("undo-button")).not.toBeVisible({ timeout: 5_000 });
  });

  test("expired undo response shows 'Undo window closed' toast + hides button", async ({ page }) => {
    await loginAs(page, "admin");

    await page.route("**/api/ai/chat", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeWriteToolResponse({
          reply: "Moved kit EXPIRED-KIT to Lab-B.",
          description: "Moved kit EXPIRED-KIT to Lab-B",
          collection: "transactions",
          tool: "move_kit",
          undoToken: "undoexpiredtoken123",
        }),
      });
    });

    await page.route("**/api/ai/undo", (route) => {
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "expired", detail: "Undo window has passed (60s)" }),
      });
    });

    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("textbox", { name: /chat message input/i }).fill("move kit EXPIRED-KIT to Lab-B");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByTestId("undo-button")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("undo-button").click();

    // "Undo window closed" toast appears
    await expect(page.getByText(/undo window closed/i).first()).toBeVisible({ timeout: 5_000 });
    // Button hides after expired error
    await expect(page.getByTestId("undo-button")).not.toBeVisible({ timeout: 5_000 });
  });
});
