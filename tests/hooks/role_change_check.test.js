import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("role_change_check hook", () => {
  let pb, baseUrl, suToken;
  let adminToken, adminId;
  let userToken, userId;
  let viewerToken, viewerId;
  let admin2Token, admin2Id;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // admin@hook-test.local already created by startPb()
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0].id;

    // second admin — used to test admin changing another user's role
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin2@role-test.local",
        password: "Adminpass2!",
        passwordConfirm: "Adminpass2!",
        role: "admin",
        name: "Role Test Admin2",
      }),
    });
    admin2Token = await authUser(baseUrl, "admin2@role-test.local", "Adminpass2!");
    const admin2Res = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin2@role-test.local"`,
      { headers: { Authorization: suToken } }
    );
    admin2Id = (await admin2Res.json()).items[0].id;

    // regular user
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@role-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Role Test User",
      }),
    });
    userToken = await authUser(baseUrl, "user@role-test.local", "Userpass1!");
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="user@role-test.local"`,
      { headers: { Authorization: suToken } }
    );
    userId = (await userRes.json()).items[0].id;

    // viewer
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "viewer@role-test.local",
        password: "Viewerpass1!",
        passwordConfirm: "Viewerpass1!",
        role: "viewer",
        name: "Role Test Viewer",
      }),
    });
    viewerToken = await authUser(baseUrl, "viewer@role-test.local", "Viewerpass1!");
    const viewerRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="viewer@role-test.local"`,
      { headers: { Authorization: suToken } }
    );
    viewerId = (await viewerRes.json()).items[0].id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  // Admin can change own role (role_change_check allows admins; last_admin_check
  // would block this only if it were the last admin — but we have two admins here).
  it("admin can change own role to user (2 admins present)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(200);
    // restore
    await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
  });

  // Admin can change another user's role
  it("admin can change another user's role", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(200);
    // restore
    await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
  });

  // Non-admin PATCHing own role from user → admin: rejected
  it("non-admin user cannot self-promote role to admin", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(400);
  });

  // Non-admin PATCHing own non-role field: allowed
  it("non-admin user can update own name (no role change)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Role Test User Updated" }),
    });
    expect(res.status).toBe(200);
    // restore
    await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Role Test User" }),
    });
  });

  // Viewer PATCHing own role: rejected
  it("viewer cannot self-promote role to user", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${viewerId}`, {
      method: "PATCH",
      headers: { Authorization: viewerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    });
    expect(res.status).toBe(400);
  });
});
