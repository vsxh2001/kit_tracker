import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/tg/link/code (tg_link.pb.js)
//
// No Telegram network access needed — the mint endpoint only writes to
// tg_link_codes and returns the code. TELEGRAM_BOT_USERNAME is unset so
// deep_link is omitted.

describe("tg_link hook (POST /api/tg/link/code)", () => {
  let pb, baseUrl, suToken, adminToken, userToken, userId, userId2;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a regular user for mint tests
    const u1 = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "linker@tg-link-test.local",
        password: "Linkerpass1!",
        passwordConfirm: "Linkerpass1!",
        role: "user",
        name: "TG Linker",
      }),
    });
    const u1Data = await u1.json();
    userId = u1Data.id;
    userToken = await authUser(baseUrl, "linker@tg-link-test.local", "Linkerpass1!");

    // Second user for isolation tests
    const u2 = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "linker2@tg-link-test.local",
        password: "Linker2pass1!",
        passwordConfirm: "Linker2pass1!",
        role: "user",
        name: "TG Linker 2",
      }),
    });
    const u2Data = await u2.json();
    userId2 = u2Data.id;
  }, 60000);

  afterAll(stopPb);

  // ---------- auth gate ----------

  it("returns 401 without Authorization header", async () => {
    const res = await fetch(`${baseUrl}/api/tg/link/code`, { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("auth required");
  });

  // ---------- happy path ----------

  it("returns 200 with code, expires_at, instructions for an authenticated user", async () => {
    const res = await fetch(`${baseUrl}/api/tg/link/code`, {
      method: "POST",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.code).toBe("string");
    expect(body.code).toHaveLength(32);
    // Must be all hex characters
    expect(body.code).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof body.expires_at).toBe("string");
    expect(body.expires_at.length).toBeGreaterThan(0);
    expect(typeof body.instructions).toBe("string");
    // Without TELEGRAM_BOT_USERNAME env, no deep_link
    expect(body.deep_link).toBeUndefined();
  });

  it("persists a tg_link_codes row bound to the requesting user with used=false", async () => {
    const res = await fetch(`${baseUrl}/api/tg/link/code`, {
      method: "POST",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const { code } = await res.json();

    // Read back via superuser token (collection rules are null — use suToken)
    const rows = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records?filter=(code="${code}")`,
      { headers: { Authorization: suToken } }
    );
    expect(rows.status).toBe(200);
    const data = await rows.json();
    expect(data.items).toHaveLength(1);
    const row = data.items[0];
    expect(row.user).toBe(userId);
    expect(row.used).toBe(false);
    expect(row.code).toBe(code);
  });

  it("admin user can also mint a code for themselves", async () => {
    const res = await fetch(`${baseUrl}/api/tg/link/code`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[0-9a-f]{32}$/);
  });

  // ---------- one-live-code invariant ----------

  it("minting a second code invalidates the prior unused code (only one live code per user)", async () => {
    // Mint first code for user2 (to keep isolation from userId's codes)
    const r1 = await fetch(`${baseUrl}/api/tg/link/code`, {
      method: "POST",
      headers: {
        Authorization: await authUser(baseUrl, "linker2@tg-link-test.local", "Linker2pass1!"),
        "Content-Type": "application/json",
      },
    });
    expect(r1.status).toBe(200);
    const { code: code1 } = await r1.json();

    // Mint second code — this should delete the first
    const r2 = await fetch(`${baseUrl}/api/tg/link/code`, {
      method: "POST",
      headers: {
        Authorization: await authUser(baseUrl, "linker2@tg-link-test.local", "Linker2pass1!"),
        "Content-Type": "application/json",
      },
    });
    expect(r2.status).toBe(200);
    const { code: code2 } = await r2.json();

    expect(code1).not.toBe(code2);

    // Prior code row should be gone
    const check1 = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records?filter=(code="${code1}")`,
      { headers: { Authorization: suToken } }
    );
    const data1 = await check1.json();
    expect(data1.items).toHaveLength(0);

    // New code row should exist
    const check2 = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records?filter=(code="${code2}")`,
      { headers: { Authorization: suToken } }
    );
    const data2 = await check2.json();
    expect(data2.items).toHaveLength(1);
    expect(data2.items[0].user).toBe(userId2);
  });

  it("each successive mint produces a different code", async () => {
    const codes = new Set();
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/tg/link/code`, {
        method: "POST",
        headers: { Authorization: adminToken, "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const { code } = await res.json();
      codes.add(code);
    }
    expect(codes.size).toBe(3);
  });
});
