import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for GET /api/wa/admin/status auth gates.
//
// Source: pb/pb_hooks/wa_meta_status.pb.js
//   - Line 22-24: returns 403 when authRecord missing or role != "admin"
//   - Lines 29-32: env vars default to "" when unset; conditional blocks
//     (phoneNumberId && waToken, waToken, wabaId && waToken) all short-circuit →
//     no live graph.facebook.com calls → handler returns 200 with nulled fields.

describe("wa_meta_status auth gates", () => {
  let baseUrl;
  let suToken;
  let adminToken;
  let userToken;

  beforeAll(async () => {
    // No WHATSAPP_* env vars set → env blocks short-circuit; no external calls.
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_WABA_ID;

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Admin user seeded by startPb: admin@hook-test.local / Adminpass1!
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a non-admin (role="user") for the 403 gate test.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonadmin@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Non-Admin Test User",
      }),
    });
    userToken = await authUser(baseUrl, "nonadmin@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/status`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/status`, {
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  // WHATSAPP_* env vars are unset → all graph.facebook.com fetch blocks
  // short-circuit (phoneNumberId="", waToken="", wabaId="" all falsy).
  // Handler reaches c.json(200, result) with phoneNumber/token/waba all null.
  it("returns 200 for an admin token when WHATSAPP_* env vars are unset", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/status`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("phoneNumber", null);
    expect(body).toHaveProperty("token", null);
    expect(body).toHaveProperty("waba", null);
    expect(body).toHaveProperty("webhook");
    expect(body.webhook).toHaveProperty("verify_token_set", false);
  });
});
