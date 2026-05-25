import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for the invite link endpoints.
//
// Source: pb/pb_hooks/invite_accept.pb.js
//   POST /api/invite/create          → admin only → { url, invite_id, expires_at }
//   GET  /api/invite/preview/:token  → { role, expires_at } (never the bound email)
//   POST /api/invite/accept          → { token, email, name, password } → { token, record }
//
// Tokens are HMAC-SHA256 hashed server-side; the raw token only lives in the
// returned `url` (.../invite/<raw>). Tests extract it from there.

describe("invite_accept endpoints", () => {
  let baseUrl, suToken, adminToken, userToken;

  // Create an invite via the admin endpoint; return { invite_id, token, expires_at }.
  async function createInvite(extra = {}) {
    const res = await fetch(`${baseUrl}/api/invite/create`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", ...extra }),
    });
    const body = await res.json();
    return { status: res.status, body, token: body.url ? body.url.split("/invite/")[1] : undefined };
  }

  // Superuser bypasses updateRule=null to force used/revoked/expired states.
  function patchInvite(id, fields) {
    return fetch(`${baseUrl}/api/collections/invites/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  function accept(body) {
    return fetch(`${baseUrl}/api/invite/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@hook-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Hook Test User",
      }),
    });
    userToken = await authUser(baseUrl, "user@hook-test.local", "Userpass1!");
  }, 60000);

  afterAll(stopPb);

  // ── create ──────────────────────────────────────────────

  it("create: returns 403 for a non-admin caller", async () => {
    const res = await fetch(`${baseUrl}/api/invite/create`, {
      method: "POST",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("admin only");
  });

  it("create: returns 400 for an invalid role", async () => {
    const { status, body } = await createInvite({ role: "superuser" });
    expect(status).toBe(400);
    expect(body.error).toBe("role must be one of: admin, technician, user, viewer");
  });

  it("create: returns 200 with url + invite_id and persists the invite", async () => {
    const { status, body, token } = await createInvite({ role: "technician" });
    expect(status).toBe(200);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(body.invite_id).toBeTruthy();

    const rec = await fetch(`${baseUrl}/api/collections/invites/records/${body.invite_id}`, {
      headers: { Authorization: suToken },
    });
    const inv = await rec.json();
    expect(inv.role).toBe("technician");
    expect(inv.used_at).toBeFalsy();
    // Raw token is never stored — only the hash.
    expect(inv.token_hash).not.toBe(token);
  });

  // ── preview ─────────────────────────────────────────────

  it("preview: returns 400 for an unknown token", async () => {
    const res = await fetch(`${baseUrl}/api/invite/preview/not-a-real-token`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid invite link.");
  });

  it("preview: returns role + expires_at and never leaks the bound email", async () => {
    const { token } = await createInvite({ role: "viewer", email: "bound@kit.local" });
    const res = await fetch(`${baseUrl}/api/invite/preview/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("viewer");
    expect(body.expires_at).toBeTruthy();
    expect(body.email).toBeUndefined();
  });

  it("preview: returns 410 for an expired invite", async () => {
    const { body, token } = await createInvite();
    await patchInvite(body.invite_id, { expires_at: "2020-01-01 00:00:00.000Z" });
    const res = await fetch(`${baseUrl}/api/invite/preview/${token}`);
    expect(res.status).toBe(410);
  });

  it("preview: returns 410 for a revoked invite", async () => {
    const { body, token } = await createInvite();
    await patchInvite(body.invite_id, { revoked_at: "2026-05-25 00:00:00.000Z" });
    const res = await fetch(`${baseUrl}/api/invite/preview/${token}`);
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("This link was revoked.");
  });

  // ── accept ──────────────────────────────────────────────

  it("accept: returns 400 when token is missing", async () => {
    const res = await accept({ email: "x@kit.local", password: "longenough1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("token required");
  });

  it("accept: returns 400 for an invalid email", async () => {
    const { token } = await createInvite();
    const res = await accept({ token, email: "no-at-sign", password: "longenough1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("valid email required");
  });

  it("accept: returns 400 for a password shorter than 8 chars", async () => {
    const { token } = await createInvite();
    const res = await accept({ token, email: "short@kit.local", password: "abc" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("password must be at least 8 characters");
  });

  it("accept: returns 400 for an unknown token", async () => {
    const res = await accept({ token: "bogus-token", email: "x@kit.local", password: "longenough1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid invite link.");
  });

  it("accept: returns 403 when email does not match a bound invite", async () => {
    const { token } = await createInvite({ email: "owner@kit.local" });
    const res = await accept({ token, email: "intruder@kit.local", password: "longenough1" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("email does not match invite");
  });

  it("accept: returns 409 when a user with that email already exists", async () => {
    const { token } = await createInvite();
    const res = await accept({ token, email: "user@hook-test.local", password: "longenough1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("You already have an account — please log in.");
  });

  it("accept: creates the user, issues a token, and consumes the invite", async () => {
    const { body, token } = await createInvite({ role: "technician" });

    const res = await accept({
      token,
      email: "newtech@kit.local",
      name: "New Tech",
      password: "longenough1",
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.token).toBeTruthy();
    expect(out.record.email).toBe("newtech@kit.local");
    expect(out.record.role).toBe("technician");

    // User actually exists with the invite's role.
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records/${out.record.id}`,
      { headers: { Authorization: suToken } }
    );
    expect((await userRes.json()).role).toBe("technician");

    // Invite is consumed (used_at + used_by set).
    const invRes = await fetch(
      `${baseUrl}/api/collections/invites/records/${body.invite_id}`,
      { headers: { Authorization: suToken } }
    );
    const inv = await invRes.json();
    expect(inv.used_at).toBeTruthy();
    expect(inv.used_by).toBe(out.record.id);

    // Re-accepting the same token is rejected as already used.
    const again = await accept({
      token,
      email: "another@kit.local",
      password: "longenough1",
    });
    expect(again.status).toBe(410);
    expect((await again.json()).error).toBe("Link already used.");
  });
});
