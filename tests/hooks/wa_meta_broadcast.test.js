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
    // Set fake creds BEFORE startPb() so PB inherits them at boot. This lets us
    // reach the body-validation gates without hitting the 500 credentials gate
    // or making real Meta API calls. The body gates are only reachable because
    // the hook reads info.data instead of c.bind() (the bug fixed alongside).
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
      recipientFilter: { type: "phones", value: ["15551234567"] },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  it("returns 403 when a non-admin (role=user) token is sent", async () => {
    const res = await postBroadcast(baseUrl, nonAdminToken, {
      recipientFilter: { type: "phones", value: ["15551234567"] },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("admin only");
  });

  // The following gates are only reachable when the request body is parsed
  // correctly. Before the info.data fix, a valid-JSON body returned
  // 400 "invalid JSON body" — so these specific-message assertions also guard
  // against that regression.
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
      recipientFilter: { type: "phones", value: ["15551234567"] },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message.type is required");
  });

  it("returns 400 when recipientFilter.type is unsupported (entity)", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "entity", value: "warehouse" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("recipientFilter.type must be 'role' or 'phones'");
  });

  it("returns 400 when message.type is invalid", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: ["15551234567"] },
      message: { type: "image", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message.type must be 'text' or 'template'");
  });

  it("returns 400 when type=text but text is empty", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: ["15551234567"] },
      message: { type: "text", text: "   " },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message.text is required when type=text");
  });

  it("returns 400 when type=template but template.name is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: ["15551234567"] },
      message: { type: "template", template: { language: "en_US" } },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message.template.name is required when type=template");
  });

  it("returns 400 when type=role but value (role name) is missing", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("recipientFilter.value (role name) is required for type=role");
  });

  it("returns 400 when type=role but role is invalid", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "role", value: "superadmin" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("invalid role");
  });

  it("returns 400 when type=phones but value is not an array", async () => {
    const res = await postBroadcast(baseUrl, adminToken, {
      recipientFilter: { type: "phones", value: "15551234567" },
      message: { type: "text", text: "hi" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("must be an array");
  });

  it("returns 200 with zero recipients when phones list is empty (no Meta call)", async () => {
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
