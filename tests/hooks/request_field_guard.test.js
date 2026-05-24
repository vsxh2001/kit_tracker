import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("request_field_guard hook", () => {
  let pb, baseUrl, suToken;
  let adminToken;
  let techToken;
  let userToken, userId;
  let user2Token, user2Id;
  let requestId;

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // technician user
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tech@req-guard-test.local",
        password: "Techpass1!",
        passwordConfirm: "Techpass1!",
        role: "technician",
        name: "Req Guard Tech",
      }),
    });
    techToken = await authUser(baseUrl, "tech@req-guard-test.local", "Techpass1!");

    // regular user — will own the request
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@req-guard-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "Req Guard User",
      }),
    });
    userToken = await authUser(baseUrl, "user@req-guard-test.local", "Userpass1!");
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"user@req-guard-test.local"`,
      { headers: { Authorization: suToken } }
    );
    userId = (await userRes.json()).items[0].id;

    // second user — not the request owner
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user2@req-guard-test.local",
        password: "Userpass2!",
        passwordConfirm: "Userpass2!",
        role: "user",
        name: "Req Guard User2",
      }),
    });
    user2Token = await authUser(baseUrl, "user2@req-guard-test.local", "Userpass2!");
    const user2Res = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email%3D"user2@req-guard-test.local"`,
      { headers: { Authorization: suToken } }
    );
    user2Id = (await user2Res.json()).items[0].id;

    // Create a request owned by user
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const reqRes = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: userId,
        date: new Date().toISOString().replace("T", " "),
        delivery_date: tomorrow,
        status: "open",
        notes: "Guard test request",
      }),
    });
    const reqData = await reqRes.json();
    requestId = reqData.id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("admin can change request status (open → approved)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(200);
    // restore
    await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
  });

  it("technician can change request status (open → approved)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: techToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(200);
    // restore
    await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
  });

  it("owner cannot change status to non-cancelled (open → fulfilled)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "fulfilled" }),
    });
    expect(res.status).toBe(400);
  });

  it("owner cannot change status to rejected", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    expect(res.status).toBe(400);
  });

  it("owner can cancel own open request (open → cancelled)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    expect(res.status).toBe(200);
    // restore to open so remaining tests work
    await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
  });

  it("owner can update non-status fields on own open request", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: userToken, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Updated by owner" }),
    });
    expect(res.status).toBe(200);
  });

  it("non-owner user cannot update the request (collection rule blocks)", async () => {
    const res = await fetch(`${baseUrl}/api/collections/requests/records/${requestId}`, {
      method: "PATCH",
      headers: { Authorization: user2Token, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Should fail" }),
    });
    // 404 = PocketBase hides the record from non-owner non-admin (updateRule)
    expect(res.status).toBe(404);
  });
});
