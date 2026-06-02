import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for GET /api/tg/admin/status auth gates.
//
// Source: pb/pb_hooks/tg_status.pb.js
//   - Lines admin gate: returns 403 when authRecord missing or role != "admin"
//   - TELEGRAM_BOT_TOKEN unset → returns 200 { configured: false }

describe("tg_status auth gates", () => {
  let baseUrl;
  let adminToken;
  let userToken;

  beforeAll(async () => {
    // No TELEGRAM_* env vars set → short-circuits to { configured: false }; no external calls.
    delete process.env.TELEGRAM_BOT_TOKEN;

    const pb = await startPb();
    baseUrl = pb.baseUrl;

    // Admin user seeded by startPb: admin@hook-test.local / Adminpass1!
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a non-admin (role="user") for the 403 gate test.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: pb.suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonadmin-tg@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Non-Admin TG Test User",
      }),
    });
    userToken = await authUser(baseUrl, "nonadmin-tg@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("returns 403 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/tg/admin/status`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/tg/admin/status`, {
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  // TELEGRAM_BOT_TOKEN is unset → handler returns 200 { configured: false }
  it("returns 200 { configured: false } for admin when TELEGRAM_BOT_TOKEN is unset", async () => {
    const res = await fetch(`${baseUrl}/api/tg/admin/status`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("configured", false);
  });
});
