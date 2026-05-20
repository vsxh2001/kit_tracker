import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Verify last_admin_check.pb.js uses limit=2 (not limit=0).
// PB v0.22: limit=0 is invalid and silently makes findRecordsByFilter a no-op,
// leaving the hook inert. This test would still pass even with limit=0 — the
// source-read assertion below documents the intent explicitly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("last_admin_check hook", () => {
  let pb, baseUrl, suToken;
  let admin1Token, admin1Id;
  let admin2Token, admin2Id;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // admin@hook-test.local already seeded by startPb()
    admin1Token = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");
    const a1Res = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    admin1Id = (await a1Res.json()).items[0].id;

    // second admin
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin2@last-admin-test.local",
        password: "Adminpass2!",
        passwordConfirm: "Adminpass2!",
        role: "admin",
        name: "Last Admin Test Admin2",
      }),
    });
    admin2Token = await authUser(baseUrl, "admin2@last-admin-test.local", "Adminpass2!");
    const a2Res = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin2@last-admin-test.local"`,
      { headers: { Authorization: suToken } }
    );
    admin2Id = (await a2Res.json()).items[0].id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // CRITICAL source check: hook must use limit=2 (not limit=0)
  it("hook source uses limit=2 in findRecordsByFilter (not limit=0)", () => {
    const src = readFileSync(
      join(process.cwd(), "pb/pb_hooks/last_admin_check.pb.js"),
      "utf8"
    );
    // The function call site: findRecordsByFilter("users", ..., "", 2, 0, ...)
    // Ensure '2' appears as the limit argument (4th positional arg after sort "")
    expect(src).toMatch(/findRecordsByFilter\s*\(\s*["']users["'][^)]*,\s*["']["']\s*,\s*2\s*,/);
    // Ensure limit=0 variant (which would be a bug) is NOT used as the limit
    // The pattern ,\s*0\s*, between the sort "" and the offset 0 would be the bug
    // i.e. ("users", filter, "", 0, 0, ...) — double-zero after empty sort string
    expect(src).not.toMatch(/findRecordsByFilter\s*\(\s*["']users["'][^)]*,\s*["']["']\s*,\s*0\s*,\s*0\s*,/);
  });

  // 2 admins exist — demote one: allowed
  it("demoting one admin is allowed when 2 admins exist", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(200);
    // restore admin2
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
  });

  // 1 admin left — demote: rejected
  it("demoting the last admin is rejected (400)", async () => {
    // First demote admin2 so only admin1 remains
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });

    const res = await fetch(`${baseUrl}/api/collections/users/records/${admin1Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(400);

    // restore admin2 for subsequent tests
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
  });

  // 1 admin — change name only: allowed
  it("changing last admin's name (not role) is allowed", async () => {
    // Demote admin2 so only admin1 remains
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });

    const res = await fetch(`${baseUrl}/api/collections/users/records/${admin1Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hook Test Admin Renamed" }),
    });
    expect(res.status).toBe(200);

    // restore
    await fetch(`${baseUrl}/api/collections/users/records/${admin1Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hook Test Admin" }),
    });
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
  });

  // 1 admin — set role to "admin" (same value, no-op): allowed
  it("setting last admin role to admin (no-op) is allowed", async () => {
    // Demote admin2 so only admin1 remains
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });

    const res = await fetch(`${baseUrl}/api/collections/users/records/${admin1Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);

    // restore admin2
    await fetch(`${baseUrl}/api/collections/users/records/${admin2Id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
  });
});
