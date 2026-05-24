import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("users_field_guard hook", () => {
  let baseUrl, suToken;
  let adminToken;
  let userToken, userId;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@field-guard-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Field Guard User",
      }),
    });
    userToken = await authUser(baseUrl, "user@field-guard-test.local", "Userpass1!");
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="user@field-guard-test.local"`,
      { headers: { Authorization: suToken } }
    );
    userId = (await userRes.json()).items[0].id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("admin can set denial_notes on a user", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ denial_notes: "Denied for testing" }),
    });
    expect(res.status).toBe(200);
    // restore
    await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ denial_notes: "" }),
    });
  });

  it("non-admin cannot change denial_notes on their own record", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ denial_notes: "self-approved" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/Only admins can change denial_notes/i);
  });

  it("non-admin can update their own non-guarded fields", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${userId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    });
    expect(res.status).toBe(200);
  });
});
