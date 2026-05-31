/**
 * Slash-command chat sidebar — smoke tests.
 *
 * Covers:
 *   - Floating "Commands" button is visible after login
 *   - Clicking it opens the chat drawer
 *   - /kits command renders a result
 *   - Free text (non-slash) shows "Unknown command" hint
 *   - /find renders results when there is at least one kit
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createTestKit, deleteKit } from "./helpers/api";

const TS = `chat-${Date.now()}`;

test.describe("Chat slash-command sidebar @smoke", () => {
  let kitId: string;

  test.beforeAll(async () => {
    const kit = await createTestKit(`${TS}-FIND`);
    kitId = kit.id;
  });

  test.afterAll(async () => {
    await deleteKit(kitId);
  });

  test("floating Commands button is visible after login @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page.getByRole("button", { name: /open commands/i })).toBeVisible();
  });

  test("clicking Commands opens the chat drawer @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /open commands/i }).click();
    await expect(page.getByRole("complementary", { name: /chat/i })).toBeVisible();
    await expect(page.getByText(/type \/help/i).first()).toBeVisible();
  });

  test("/kits renders a result @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /open commands/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("/kits ");
    await input.press("Enter");

    // Should show either a kit list or "No active kits found."
    await expect(
      page.locator("text=/active kits|No active kits/i").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("free text shows Unknown command hint @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /open commands/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill("hello there");
    await input.press("Enter");

    await expect(page.getByText(/unknown command/i)).toBeVisible({ timeout: 5_000 });
  });

  test("/find matches seeded kit @smoke", async ({ page }) => {
    await loginAs(page, "admin");
    await page.getByRole("button", { name: /open commands/i }).click();

    const input = page.getByRole("textbox", { name: /chat message input/i });
    await input.fill(`/find ${TS}`);
    await input.press("Enter");

    await expect(page.getByText(`${TS}-FIND`)).toBeVisible({ timeout: 10_000 });
  });
});
