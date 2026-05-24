import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

describe("users_delete_check hook", () => {
  let baseUrl, suToken;
  let adminToken, adminId;
  let targetId;

  beforeAll(async () => {
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=email="admin@hook-test.local"`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0].id;

    // Create a second user that the admin can attempt to delete
    const targetRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "target@delete-test.local",
        password: "Targetpass1!",
        passwordConfirm: "Targetpass1!",
        role: "user",
        name: "Delete Target",
      }),
    });
    targetId = (await targetRes.json()).id;
  }, 60000);

  afterAll(async () => {
    await stopPb();
  });

  it("admin cannot delete their own account", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      method: "DELETE",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/own account/i);
  });

  it("admin can delete another user's account", async () => {
    const res = await fetch(`${baseUrl}/api/collections/users/records/${targetId}`, {
      method: "DELETE",
      headers: { Authorization: adminToken },
    });
    expect(res.status).toBe(204);
  });

  it("superuser panel token can delete a user (hook skips when authRecord is null)", async () => {
    // Create a fresh user to delete via superuser
    const createRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "su-target@delete-test.local",
        password: "Targetpass1!",
        passwordConfirm: "Targetpass1!",
        role: "user",
        name: "SU Delete Target",
      }),
    });
    const suTargetId = (await createRes.json()).id;

    const res = await fetch(`${baseUrl}/api/collections/users/records/${suTargetId}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
    expect(res.status).toBe(204);
  });
});
