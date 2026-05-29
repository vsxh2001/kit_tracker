import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/tg/broadcast (admin-initiated Telegram broadcast).
// Source: pb/pb_hooks/tg_broadcast.pb.js
//
// TELEGRAM_BOT_TOKEN is NOT set in most tests — we exercise the auth + body-validation
// gates (which fire BEFORE the creds check) without real Telegram network calls.
// The 500-creds test explicitly verifies the token-unset path.

async function postBroadcast(baseUrl, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return fetch(`${baseUrl}/api/tg/broadcast`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("tg_broadcast hook (POST /api/tg/broadcast)", () => {
  let baseUrl, suToken;
  let adminToken, nonAdminToken;

  beforeAll(async () => {
    // TELEGRAM_BOT_TOKEN intentionally NOT set — creds gate fires after validation passes.
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
        email: "nonadmin@tg-broadcast-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "TG Broadcast Non-Admin",
      }),
    });
    nonAdminToken = await authUser(baseUrl, "nonadmin@tg-broadcast-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 when no Authorization header is sent", async () => {
    const res = await postBroadcast(baseUrl, null, {
      recipientFilter: { type: "role", value: "admin" },
      text: "hello",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await postBroadcast(baseUrl, nonAdminToken, {
      recipientFilter: { type: "role", value: "admin" },
      text: "hello",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 400 when recipientFilter is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      text: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("recipientFilter.type is required");
  });

  it("returns 400 when recipientFilter.type is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { value: "admin" },
      text: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("recipientFilter.type is required");
  });

  it("returns 400 when recipientFilter.type is invalid (phones)", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: ["123"] },
      text: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("recipientFilter.type must be 'role' or 'chat_ids'");
  });

  it("returns 400 when recipientFilter.type is invalid (entity)", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "entity", value: "warehouse" },
      text: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("recipientFilter.type must be 'role' or 'chat_ids'");
  });

  it("returns 400 when text is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "admin" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("text is required");
  });

  it("returns 400 when text is empty string", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "admin" },
      text: "   ",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("text is required");
  });

  it("returns 400 when type=role and role value is invalid", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "superadmin" },
      text: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("invalid role");
  });

  it("returns 400 when type=chat_ids and value is not an array", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "chat_ids", value: "123456" },
      text: "hello",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("must be an array");
  });

  it("returns 200 with zero recipients when chat_ids list is empty (no creds needed)", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "chat_ids", value: [] },
      text: "hello",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
  });

  it("returns 500 'Telegram credentials not configured' for valid body with no token (type=role)", async () => {
    // TELEGRAM_BOT_TOKEN unset → creds gate fires after recipients are resolved.
    // type=role with no linked users → total=0 → returns 200 before creds check.
    // Use a non-empty chat_ids list to force past the early-return and hit creds gate.
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "chat_ids", value: ["-1001234567890"] },
      text: "hello",
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Telegram credentials not configured");
  });
});
