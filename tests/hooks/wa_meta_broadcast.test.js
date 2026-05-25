import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

async function postBroadcast(baseUrl, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return fetch(`${baseUrl}/api/wa/broadcast`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("wa_meta_broadcast auth + body-validation gates", () => {
  let baseUrl, suToken;
  let adminToken, nonAdminToken;

  beforeAll(async () => {
    // Set fake creds BEFORE startPb() so PB inherits them at boot.
    // This lets us reach the body-validation gates without hitting the
    // 500 credentials gate or making real Meta API calls.
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test_phone_id";
    process.env.WHATSAPP_TOKEN = "test_token";

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonadmin@wa-broadcast-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "WA Broadcast Non-Admin",
      }),
    });
    nonAdminToken = await authUser(baseUrl, "nonadmin@wa-broadcast-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  it("returns 403 when no Authorization header is sent", async () => {
    const res = await postBroadcast(baseUrl, null, {
      recipientFilter: { type: "role", value: "admin" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 when a non-admin (role=user) token is sent", async () => {
    const res = await postBroadcast(baseUrl, nonAdminToken, {
      recipientFilter: { type: "role", value: "admin" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 400 when recipientFilter is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("recipientFilter.type is required");
  });

  it("returns 400 when message is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "admin" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message.type is required");
  });

  it("returns 400 for unsupported recipientFilter.type=entity", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "entity", value: "someEntity" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/'entity' not supported/i);
  });

  it("returns 400 for unsupported message.type", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "admin" },
      message: { type: "audio" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/message\.type must be 'text' or 'template'/);
  });

  it("returns 400 when type=phones but value is not an array", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: "972527799932" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/array/);
  });

  it("returns 200 with successCount=0 when type=phones and empty array provided", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: [] },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRecipients).toBe(0);
    expect(body.successCount).toBe(0);
  });
});
