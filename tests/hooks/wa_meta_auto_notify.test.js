import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for pb/pb_hooks/wa_meta_auto_notify.pb.js
//
// Strategy: set fake WA creds so hooks reach the audit-write code path.
// The $http.send call will fail (fake creds), but the audit write is in its
// own try/catch AFTER the HTTP block, so it always fires.
// We assert that the resulting send_whatsapp audit_log row has actor set —
// fixing the silent-fail regression described in issue #180.

const TS = `wanotify-${Date.now()}`;

describe("wa_meta_auto_notify — send_whatsapp audit actor", () => {
  let baseUrl, suToken, adminToken, adminId;
  let requesterId;
  let kitId, entityId;

  async function suPost(path, body) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function suPatch(path, body) {
    return fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    // Fake creds so hooks reach the WA send + audit path.
    // $http.send fails (fake creds/network error), but audit write fires anyway.
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test_phone_id";
    process.env.WHATSAPP_TOKEN = "test_token";

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0]?.id;
    expect(adminId, "seeded admin must exist").toBeTruthy();
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const rRes = await suPost("/api/collections/users/records", {
      email: `${TS}-req@wa.local`,
      password: "Testpass1!",
      passwordConfirm: "Testpass1!",
      name: "AuditReq",
      role: "user",
      phone: "+972500000088",
    });
    expect(rRes.status, "create requester").toBe(200);
    requesterId = (await rRes.json()).id;

    const kitRes = await suPost("/api/collections/kits/records", {
      serial: `${TS}-KIT`,
      is_active: true,
    });
    expect(kitRes.status, "create kit").toBe(200);
    kitId = (await kitRes.json()).id;

    const entRes = await suPost("/api/collections/entities/records", {
      name: `${TS}-Entity`,
      category: "field",
      is_active: true,
    });
    expect(entRes.status, "create entity").toBe(200);
    entityId = (await entRes.json()).id;
  }, 60_000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  it("approved→fulfilled: send_whatsapp audit row written with actor=requesterId", async () => {
    const createRes = await suPost("/api/collections/requests/records", {
      requester: requesterId,
      date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open",
      designated_kit: kitId,
      target_entity: entityId,
    });
    expect(createRes.status, "create request").toBe(200);
    const req = await createRes.json();

    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const fulfillRes = await suPatch(
      `/api/collections/requests/records/${req.id}`,
      { status: "fulfilled" }
    );
    expect(fulfillRes.status, "approved→fulfilled").toBe(200);

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(
        `action="send_whatsapp" && actor="${requesterId}"`
      )}`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    expect(
      auditBody.items.length,
      "send_whatsapp audit row must exist with actor=requesterId"
    ).toBeGreaterThanOrEqual(1);
    const row = auditBody.items[0];
    expect(row.actor).toBe(requesterId);
    const changes = JSON.parse(row.changes);
    expect(changes.event).toBe("request_fulfilled");
  }, 30_000);

  it("request_pending: send_whatsapp audit row written with actor=adminId", async () => {
    await suPatch(`/api/collections/users/records/${adminId}`, {
      phone: "+972500000077",
    });

    const createRes = await suPost("/api/collections/requests/records", {
      requester: requesterId,
      date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open",
    });
    expect(createRes.status, "create request triggers request_pending hook").toBe(200);

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(
        `action="send_whatsapp" && actor="${adminId}"`
      )}`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    expect(
      auditBody.items.length,
      "send_whatsapp audit row must exist with actor=adminId"
    ).toBeGreaterThanOrEqual(1);
    const row = auditBody.items[0];
    expect(row.actor).toBe(adminId);
    const changes = JSON.parse(row.changes);
    expect(changes.event).toBe("request_pending");

    await suPatch(`/api/collections/users/records/${adminId}`, { phone: "" });
  }, 30_000);
});
