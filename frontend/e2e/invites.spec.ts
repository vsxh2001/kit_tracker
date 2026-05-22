/**
 * E2E tests for invite email-binding (security P1, task #115).
 *
 * These tests call the invite API directly (no UI) to exercise the hook logic.
 * A UI smoke test verifies the admin can open the Invite dialog and see the
 * recipient email field.
 */

import { test, expect } from "@playwright/test";
import { getAdminToken } from "./helpers/api";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createBoundInvite(role: string, email: string): Promise<{ url: string; invite_id: string }> {
  const token = await getAdminToken();
  const res = await fetch(`${PB_URL}/api/invite/create`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ role, email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`createBoundInvite failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return res.json();
}

async function acceptInvite(rawToken: string, email: string, password: string): Promise<Response> {
  return fetch(`${PB_URL}/api/invite/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: rawToken, email, password, name: "Test User" }),
  });
}

/** Extract the raw token from an invite URL like http://host/invite/<token> */
function extractToken(url: string): string {
  const parts = url.split("/invite/");
  if (parts.length < 2 || !parts[1]) throw new Error(`Cannot extract token from URL: ${url}`);
  return parts[1];
}

/** Delete a user by email via superuser API for teardown */
async function deleteUserByEmail(email: string): Promise<void> {
  const token = await getAdminToken();
  // List to find the user id
  const listRes = await fetch(
    `${PB_URL}/api/collections/users/records?filter=email%3D%22${encodeURIComponent(email)}%22`,
    { headers: { Authorization: token } }
  );
  if (!listRes.ok) return;
  const data = await listRes.json();
  const record = data.items?.[0];
  if (!record) return;
  await fetch(`${PB_URL}/api/collections/users/records/${record.id}`, {
    method: "DELETE",
    headers: { Authorization: token },
  });
}

/** Revoke an invite by id for teardown */
async function revokeInvite(inviteId: string): Promise<void> {
  const token = await getAdminToken();
  const now = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
  await fetch(`${PB_URL}/api/collections/invites/records/${inviteId}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ revoked_at: now }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Invite email binding", () => {
  const ts = Date.now();
  const boundEmail = `invite-bound-${ts}@test.local`;
  const wrongEmail = `invite-wrong-${ts}@test.local`;

  test("mismatched email rejected with 403 @smoke", async () => {
    let inviteId: string | undefined;
    try {
      const invite = await createBoundInvite("user", boundEmail);
      inviteId = invite.invite_id;
      const rawToken = extractToken(invite.url);

      // Try to accept with a different email
      const res = await acceptInvite(rawToken, wrongEmail, "Password1234!");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("email does not match invite");
    } finally {
      if (inviteId) await revokeInvite(inviteId);
    }
  });

  test("matching email accepted and account created @smoke", async () => {
    try {
      const invite = await createBoundInvite("user", boundEmail);
      const rawToken = extractToken(invite.url);

      // Accept with the correct email
      const res = await acceptInvite(rawToken, boundEmail, "Password1234!");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTruthy();
      expect(body.record.email).toBe(boundEmail);
      expect(body.record.role).toBe("user");
    } finally {
      await deleteUserByEmail(boundEmail);
      // invite is already used; no need to revoke
    }
  });

  test("legacy invite (no email) accepts any email", async () => {
    const legacyEmail = `invite-legacy-${ts}@test.local`;
    try {
      // Create invite without email field (empty string → hook omits it)
      const token = await getAdminToken();
      const res = await fetch(`${PB_URL}/api/invite/create`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }), // no email key
      });
      expect(res.ok).toBeTruthy();
      const invite = await res.json();
      const rawToken = extractToken(invite.url);

      const acceptRes = await acceptInvite(rawToken, legacyEmail, "Password1234!");
      expect(acceptRes.status).toBe(200);
    } finally {
      await deleteUserByEmail(legacyEmail);
    }
  });

  test("admin Invite dialog shows recipient email field @smoke", async ({ page }) => {
    // Login as admin
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill("logistics@kit.local");
    await page.getByLabel(/password/i).fill("Pass1234!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });

    // Navigate to users page
    await page.goto(`${BASE_URL}/users`);
    await expect(page.getByRole("heading", { name: /users/i })).toBeVisible({ timeout: 8_000 });

    // Open invite dialog
    await page.getByRole("button", { name: /invite/i }).click();
    await expect(page.getByLabel(/recipient email/i)).toBeVisible({ timeout: 5_000 });
  });
});
