import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

async function postSend(baseUrl, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return fetch(`${baseUrl}/api/wa/send`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("wa_meta_send auth + body-validation gates", () => {
  let baseUrl, suToken;
  let adminToken, nonAdminToken;

  beforeAll(async () => {
    // Set fake creds BEFORE startPb() so PB inherits them at boot.
    // This lets us reach the body-validation gates (lines 53-65) without
    // hitting the 500 credentials gate or making real Meta API calls.
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test_phone_id";
    process.env.WHATSAPP_TOKEN = "test_token";

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // The helper seeds admin@hook-test.local (role=admin) — get its token.
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a non-admin (role=user) and authenticate as them.
    await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonadmin@wa-send-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "WA Send Non-Admin",
      }),
    });
    nonAdminToken = await authUser(baseUrl, "nonadmin@wa-send-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  it("returns 403 when no Authorization header is sent", async () => {
    const res = await postSend(baseUrl, null, { to: "15551234567", text: "hi" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 when a non-admin (role=user) token is sent", async () => {
    const res = await postSend(baseUrl, nonAdminToken, { to: "15551234567", text: "hi" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 400 when admin sends body missing 'to'", async () => {
    const res = await postSend(baseUrl, adminToken, { text: "hi" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("to is required");
  });

  it("returns 400 when admin sends body with 'to' but neither text nor template", async () => {
    const res = await postSend(baseUrl, adminToken, { to: "15551234567" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("either text or template is required");
  });

  it("returns 400 when admin sends both text and template", async () => {
    const res = await postSend(baseUrl, adminToken, {
      to: "15551234567",
      text: "hi",
      template: { name: "hello_world" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("provide either text or template, not both");
  });
});
