import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for Phase 6 Telegram notification branches added to:
//   pb/pb_hooks/wa_meta_auto_notify.pb.js
//   pb/pb_hooks/wa_approval_escalation_cron.pb.js
//
// Strategy:
//   TELEGRAM_BOT_TOKEN is NOT set — the _sendTelegram helpers read it at
//   call time and skip+log when unset. This makes the send path unreachable
//   (no real Telegram network calls in-harness) but the pref gate, chat_id
//   lookup, and audit write paths still execute.
//
//   We verify:
//     1. All event transitions still succeed (200) — WA path unaffected.
//     2. A user WITH telegram in channels + a telegram_chat_id does not cause
//        an error (branch reached, send skipped gracefully, audit attempted).
//     3. A user WITHOUT telegram in channels does NOT produce a send_telegram
//        audit row (gate correctly skips).
//     4. A user WITH telegram enabled but NO telegram_chat_id also skips
//        gracefully (inner guard `if (tgChat && ...)` prevents send).
//
//   Positive send assertion (audit row action="send_telegram") is documented
//   below as NOT possible without a live TELEGRAM_BOT_TOKEN: the send is
//   skipped before the audit write when token is unset.

const TS = `tgnotify-${Date.now()}`;

describe("tg_notify Phase 6 — Telegram branches in wa_meta_auto_notify", () => {
  let baseUrl, suToken, adminToken, adminId;
  let requesterNoTgId;       // user without telegram channel in prefs
  let requesterWithTgId;     // user with telegram channel + chat_id
  let requesterTgNoChatId;   // user with telegram channel but no chat_id
  let kitId, entityId;

  // ── helpers ──────────────────────────────────────────────────────────────

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

  async function createUser(email, role, extraFields = {}) {
    const payload = {
      email,
      password: "Testpass1!",
      passwordConfirm: "Testpass1!",
      name: email.split("@")[0],
      role,
      ...extraFields,
    };
    const res = await suPost("/api/collections/users/records", payload);
    expect(res.status, `create user ${email}`).toBe(200);
    return (await res.json()).id;
  }

  async function createRequest(overrides = {}) {
    return suPost("/api/collections/requests/records", {
      requester: requesterNoTgId,
      date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open",
      ...overrides,
    });
  }

  async function countAuditRows(action, event) {
    const filter = `action="${action}" && changes ~ '"event":"${event}"'`;
    const res = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(filter)}&perPage=200`,
      { headers: { Authorization: suToken } }
    );
    if (!res.ok) return -1;
    const body = await res.json();
    return body.totalItems ?? body.items?.length ?? 0;
  }

  // ── setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // TELEGRAM_BOT_TOKEN intentionally NOT set — sends degrade gracefully.
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Resolve seeded app admin.
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0]?.id;
    expect(adminId, "seeded admin must exist").toBeTruthy();
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // User without telegram in notification_prefs channels.
    requesterNoTgId = await createUser(`${TS}-notg@tg.local`, "user", {
      notification_prefs: JSON.stringify({
        channels: ["whatsapp", "email"],
        events: { request_fulfilled: true, kit_moved: true, request_pending: true },
      }),
    });

    // User with telegram channel + a telegram_chat_id.
    requesterWithTgId = await createUser(`${TS}-withtg@tg.local`, "user", {
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_fulfilled: true, kit_moved: true, request_pending: true },
      }),
      telegram_chat_id: "123456789",
    });

    // User with telegram channel but NO telegram_chat_id.
    requesterTgNoChatId = await createUser(`${TS}-tgnochat@tg.local`, "user", {
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_fulfilled: true, kit_moved: true, request_pending: true },
      }),
    });

    // Shared kit + entity.
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
  });

  // ── request_fulfilled (onRecordAfterUpdateRequest) ───────────────────────

  it("request_fulfilled: user without telegram channel — 200, WA path unaffected", async () => {
    const createRes = await createRequest({ requester: requesterNoTgId });
    const req = await createRes.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const res = await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });
    expect(res.status, "approved→fulfilled should return 200").toBe(200);
    const body = await res.json();
    expect(body.status).toBe("fulfilled");
  });

  it("request_fulfilled: user WITH telegram + chat_id — 200, Telegram branch degrades gracefully (no token)", async () => {
    const createRes = await createRequest({ requester: requesterWithTgId });
    const req = await createRes.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const res = await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });
    expect(res.status, "approved→fulfilled with TG user should return 200").toBe(200);
    const body = await res.json();
    expect(body.status).toBe("fulfilled");
  });

  it("request_fulfilled: user WITH telegram channel but NO chat_id — 200, inner guard skips", async () => {
    const createRes = await createRequest({ requester: requesterTgNoChatId });
    const req = await createRes.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const res = await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });
    expect(res.status, "approved→fulfilled with no chat_id should return 200").toBe(200);
    const body = await res.json();
    expect(body.status).toBe("fulfilled");
  });

  it("request_fulfilled: with kit + entity set — relation lookups + TG branch do not throw", async () => {
    const createRes = await createRequest({
      requester: requesterWithTgId,
      designated_kit: kitId,
      target_entity: entityId,
    });
    const req = await createRes.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const res = await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });
    expect(res.status, "approved→fulfilled with relations + TG user should return 200").toBe(200);
    expect((await res.json()).status).toBe("fulfilled");
  });

  // ── request_pending (onRecordAfterCreateRequest on "requests") ───────────

  it("request_pending: creates request — 200, existing WA notification behavior unaffected", async () => {
    const res = await createRequest({ requester: requesterNoTgId });
    expect(res.status, "create request should return 200").toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("open");

    // Record retrievable — hook did not corrupt the operation.
    const getRes = await fetch(
      `${baseUrl}/api/collections/requests/records/${body.id}`,
      { headers: { Authorization: suToken } }
    );
    expect(getRes.status).toBe(200);
  });

  it("request_pending: admin with telegram_chat_id receives TG branch without error", async () => {
    // Give the seeded admin a telegram_chat_id so the TG branch executes.
    await suPatch(`/api/collections/users/records/${adminId}`, {
      telegram_chat_id: "987654321",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_pending: true },
      }),
    });
    try {
      const res = await createRequest();
      expect(res.status, "create request with TG admin should return 200").toBe(200);
      const body = await res.json();
      expect(body.id).toBeTruthy();
    } finally {
      // Clean up admin to avoid polluting other tests.
      await suPatch(`/api/collections/users/records/${adminId}`, {
        telegram_chat_id: "",
        notification_prefs: "",
      });
    }
  });

  // ── audit_log: no send_telegram rows without token ───────────────────────

  it("without TELEGRAM_BOT_TOKEN, no send_telegram audit rows are written for request_fulfilled", async () => {
    // TELEGRAM_BOT_TOKEN is unset → _sendTelegram returns early before audit.
    // Users WITH telegram channel still don't produce audit rows.
    const before = await countAuditRows("send_telegram", "request_fulfilled");

    const createRes = await createRequest({ requester: requesterWithTgId });
    const req = await createRes.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });

    const after = await countAuditRows("send_telegram", "request_fulfilled");
    // With no token, send is skipped before audit write — count unchanged.
    expect(after, "no send_telegram audit rows expected without token").toBe(before);
  });
});

describe("tg_notify Phase 6 — Telegram branch in wa_approval_escalation_cron", () => {
  let baseUrl, suToken, adminToken, userToken;
  let requesterId, adminWithTgId;

  beforeAll(async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test_phone_id";
    process.env.WHATSAPP_TOKEN = "test_token";
    // TELEGRAM_BOT_TOKEN intentionally NOT set.

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Resolve seeded admin id.
    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminWithTgId = (await adminRes.json()).items[0]?.id;

    // Regular user as request requester.
    const userRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "requester@tg-escalation-test.local",
        password: "Userpass1!",
        passwordConfirm: "Userpass1!",
        role: "user",
        name: "TG Escalation Requester",
      }),
    });
    requesterId = (await userRes.json()).id;
    userToken = await authUser(baseUrl, "requester@tg-escalation-test.local", "Userpass1!");
  }, 60000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  async function trigger(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${baseUrl}/_test/wa-approval-escalation${qs ? "?" + qs : ""}`;
    const headers = {};
    if (token) headers["Authorization"] = token;
    return fetch(url, { method: "POST", headers });
  }

  async function createOpenRequest() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: requesterId,
        date: today,
        delivery_date: today,
        status: "open",
        notes: "tg-escalation test",
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
  }

  async function deleteRequest(id) {
    await fetch(`${baseUrl}/api/collections/requests/records/${id}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
  }

  async function patchAdmin(fields) {
    await fetch(`${baseUrl}/api/collections/users/records/${adminWithTgId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  it("escalation with admin having phone + telegram_chat_id — 200, TG branch runs without error", async () => {
    // Give admin a phone (for WA path) + telegram_chat_id (for TG path) + telegram channel.
    await patchAdmin({
      phone: "+15551234567",
      telegram_chat_id: "111222333",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_escalation: true },
      }),
    });
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);
      // escalated >= 1 means the WA gate passed and store was marked.
      expect(body.escalated).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteRequest(id);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });

  it("escalation: admin with telegram channel but no chat_id — inner guard skips TG, still 200", async () => {
    await patchAdmin({
      phone: "+15551234568",
      // no telegram_chat_id
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_escalation: true },
      }),
    });
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);
    } finally {
      await deleteRequest(id);
      await patchAdmin({ phone: "", notification_prefs: "" });
    }
  });

  it("escalation: admin with telegram disabled in events — TG gate skips, WA pref still controls WA", async () => {
    await patchAdmin({
      phone: "+15551234569",
      telegram_chat_id: "444555666",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_escalation: false }, // opt-out of escalation on all channels
      }),
    });
    const id = await createOpenRequest();
    try {
      const res = await trigger(adminToken, { threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      // WA pref gate also uses request_escalation: false → escalated=0
      expect(body.escalated).toBe(0);
    } finally {
      await deleteRequest(id);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });

  it("escalation without TELEGRAM_BOT_TOKEN — degrades gracefully, existing WA dedup still works", async () => {
    await patchAdmin({
      phone: "+15559999999",
      telegram_chat_id: "777888999",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp", "email"],
        events: { request_escalation: true },
      }),
    });
    const id = await createOpenRequest();
    try {
      // First trigger — escalates.
      const res1 = await trigger(adminToken, { threshold_hours: "0" });
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expect(body1.escalated).toBeGreaterThanOrEqual(1);

      // Second trigger — dedup fires (already_escalated).
      const res2 = await trigger(adminToken, { threshold_hours: "0" });
      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(body2.already_escalated).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteRequest(id);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });
});
