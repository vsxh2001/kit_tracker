import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for GET /api/health/smtp auth gate + payload shape.
//
// Source: pb/pb_hooks/smtp_status.pb.js
//   - Line 11-14: throws ForbiddenError("admin only") when auth missing or
//     role != "admin". A thrown ApiError serializes to { message, ... } (status
//     403), unlike the c.json(403,{error}) hooks — so the 403 body key is
//     `message`, not `error`.
//   - Line 15-17: reads $app.settings().smtp; an ephemeral PB has SMTP disabled
//     by default, so an admin caller gets { enabled: false }.

describe("smtp_status auth gate", () => {
  let baseUrl;
  let suToken;
  let adminToken;
  let userToken;

  beforeAll(async () => {
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
        email: "smtp-nonadmin@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "SMTP Non-Admin Test User",
      }),
    });
    userToken = await authUser(baseUrl, "smtp-nonadmin@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/health/smtp`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe("Admin only.");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/health/smtp`, {
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe("Admin only.");
  });

  it("returns 200 with { enabled: false } for an admin token (SMTP unconfigured)", async () => {
    const res = await fetch(`${baseUrl}/api/health/smtp`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("enabled", false);
  });
});
