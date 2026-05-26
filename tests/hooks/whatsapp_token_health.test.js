import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for GET /api/health/whatsapp-token auth gate + payload shape.
//
// Source: pb/pb_hooks/whatsapp_token_health.pb.js
//   - Line 13-16: throws ForbiddenError("admin only") when auth missing or
//     role != "admin". PB normalizes the thrown message → 403 { message: "Admin only." }.
//   - Line 18-21: when WHATSAPP_TOKEN is unset, an admin gets 200 with
//     { is_valid: false, warning_level: "missing" } — no live graph.facebook.com call.

describe("whatsapp_token_health auth gate", () => {
  let baseUrl;
  let suToken;
  let adminToken;
  let userToken;

  beforeAll(async () => {
    // No WHATSAPP_TOKEN → the "missing" branch returns early before any
    // graph.facebook.com fetch, keeping the test hermetic.
    delete process.env.WHATSAPP_TOKEN;

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
        email: "watoken-nonadmin@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "WA Token Non-Admin Test User",
      }),
    });
    userToken = await authUser(baseUrl, "watoken-nonadmin@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/health/whatsapp-token`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe("Admin only.");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/health/whatsapp-token`, {
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe("Admin only.");
  });

  it("returns 200 { is_valid: false, warning_level: 'missing' } for admin when WHATSAPP_TOKEN unset", async () => {
    const res = await fetch(`${baseUrl}/api/health/whatsapp-token`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("is_valid", false);
    expect(body).toHaveProperty("warning_level", "missing");
  });
});
