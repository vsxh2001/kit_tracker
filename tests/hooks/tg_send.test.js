import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/tg/send (admin-initiated single-recipient Telegram send).
// Source: pb/pb_hooks/tg_send.pb.js
//
// TELEGRAM_BOT_TOKEN is NOT set in tests — we exercise the auth + body-validation
// gates (which fire BEFORE the creds check) without real Telegram network calls.

async function postSend(baseUrl, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return fetch(`${baseUrl}/api/tg/send`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("tg_send hook (POST /api/tg/send)", () => {
  let baseUrl, suToken;
  let adminToken, nonAdminToken;

  beforeAll(async () => {
    // TELEGRAM_BOT_TOKEN intentionally NOT set — tests must not reach real Telegram.
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // The helper seeds admin@hook-test.local (role=admin) — get its token.
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a non-admin (role=user) user and authenticate as them.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonadmin@tg-send-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "TG Send Non-Admin",
      }),
    });
    nonAdminToken = await authUser(baseUrl, "nonadmin@tg-send-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 when no Authorization header is sent", async () => {
    const res = await postSend(baseUrl, null, { chat_id: "-1001234567890", text: "hello" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await postSend(baseUrl, nonAdminToken, { chat_id: "-1001234567890", text: "hello" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 400 when admin sends body missing chat_id", async () => {
    // Validation fires BEFORE the creds check — reachable without TELEGRAM_BOT_TOKEN.
    const res = await postSend(baseUrl, adminToken, { text: "hello" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("chat_id and text are required");
  });

  it("returns 400 when admin sends body with chat_id but missing text", async () => {
    // Validation fires BEFORE the creds check — reachable without TELEGRAM_BOT_TOKEN.
    const res = await postSend(baseUrl, adminToken, { chat_id: "-1001234567890" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("chat_id and text are required");
  });

  it("returns 400 when admin sends empty string for text", async () => {
    // Whitespace-only text is trimmed to empty — treated as missing.
    const res = await postSend(baseUrl, adminToken, { chat_id: "-1001234567890", text: "   " });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("chat_id and text are required");
  });

  it("returns 500 'Telegram credentials not configured' for admin with valid body but no token", async () => {
    // TELEGRAM_BOT_TOKEN unset → creds check fires after validation passes.
    const res = await postSend(baseUrl, adminToken, { chat_id: "-1001234567890", text: "hello" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Telegram credentials not configured");
  });
});
