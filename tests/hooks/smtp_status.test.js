import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for GET /api/health/smtp auth gates + response shape.
//
// Source: pb/pb_hooks/smtp_status.pb.js
//   - Lines 11-13: throws ForbiddenError when auth missing or role != "admin"
//   - Lines 14-15: reads $app.settings().smtp.enabled; returns { enabled: boolean }
//
// SMTP is never configured in the ephemeral test PB instance, so
// settings.smtp.enabled is falsy → endpoint returns { enabled: false }.

describe("smtp_status auth gates", () => {
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

    // Create a non-admin user for the 403 gate test.
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
    const res = await fetch(`${baseUrl}/api/health/smtp`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/health/smtp`, {
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 200 with { enabled: false } for admin when SMTP is not configured", async () => {
    const res = await fetch(`${baseUrl}/api/health/smtp`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("enabled", false);
  });
});
