import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for /api/wa/admin/templates (GET list + POST submit), admin only.
//
// Source: pb/pb_hooks/wa_meta_templates.pb.js
//   - GET  line 17: 403 when authRecord missing or role != "admin"
//   - GET  line 25-27: env unset → 200 { data: [], warning }  (no Meta call)
//   - POST line 65: 403 when authRecord missing or role != "admin"
//   - POST line 73-75: env unset → 400 "...not configured"     (no Meta call)
//   - POST line 86-88: 400 field-required when body is missing required keys
//
// The POST body-parse path is exercised with fake WHATSAPP_* creds set so we
// clear the env gate, but with invalid bodies that short-circuit at field
// validation BEFORE any $http.send to graph.facebook.com — keeping the suite
// fully offline.

async function createNonAdmin(baseUrl, suToken, email) {
  await fetch(`${baseUrl}/api/collections/users/records`, {
    method: "POST",
    headers: { Authorization: suToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "Userpass1!",
      passwordConfirm: "Userpass1!",
      role: "user",
      name: "WA Templates Non-Admin",
    }),
  });
  return authUser(baseUrl, email, "Userpass1!");
}

describe("wa_meta_templates auth gates + env-not-configured", () => {
  let baseUrl, suToken, adminToken, userToken;

  beforeAll(async () => {
    // No WHATSAPP_* creds → env gates short-circuit; no external calls.
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_WABA_ID;

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");
    userToken = await createNonAdmin(baseUrl, suToken, "nonadmin@wa-templates-test.local");
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("GET returns 403 when no Authorization header is sent", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("GET returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      headers: { Authorization: userToken },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("POST returns 403 when no Authorization header is sent", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", category: "MARKETING", language: "en", components: [] }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("POST returns 403 for a non-admin (role=user) token", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      method: "POST",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", category: "MARKETING", language: "en", components: [] }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("GET returns 200 with a warning when WHATSAPP_TOKEN/WABA_ID are unset", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.warning).toMatch(/not configured/i);
  });

  it("POST returns 400 'not configured' when WHATSAPP_TOKEN/WABA_ID are unset", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", category: "MARKETING", language: "en", components: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });
});

describe("wa_meta_templates POST body parsing (creds configured)", () => {
  let baseUrl, adminToken;

  beforeAll(async () => {
    // Fake creds set BEFORE startPb so the env gate passes and we reach the
    // body parser. Invalid bodies fail field validation before any Meta call.
    process.env.WHATSAPP_TOKEN = "test_token";
    process.env.WHATSAPP_WABA_ID = "test_waba";

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_WABA_ID;
  });

  // Regression guard: the POST handler must successfully parse the request
  // body (via readerToString) even though $apis.requestInfo(c) ran first for
  // the auth gate. A body that parses but fails field validation proves the
  // body was read — guarding against a regression to "Invalid JSON body".
  it("POST with empty body reaches field validation (not 'Invalid JSON body')", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("name, category, language, and components are required");
  });

  it("POST missing the components array returns the field-required error", async () => {
    const res = await fetch(`${baseUrl}/api/wa/admin/templates`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "welcome", category: "MARKETING", language: "en_US" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("name, category, language, and components are required");
  });
});
