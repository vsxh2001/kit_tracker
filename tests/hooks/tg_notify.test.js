import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for Phase 6 Telegram notification branches added to:
//   pb/pb_hooks/wa_meta_auto_notify.pb.js
//   pb/pb_hooks/wa_approval_escalation_cron.pb.js
//
// Strategy:
//   TELEGRAM_BOT_TOKEN is NOT set — _sendTelegram returns "skipped_no_token"
//   and the audit row is still written with changes.outcome="skipped_no_token".
//   This lets tests assert the branch ACTUALLY RAN (audit row present) without
//   making real Telegram network calls.
//
//   The key assertion pattern:
//     - telegram-only user (channels=["telegram"], no phone) triggers event
//     - assert audit_log row action="send_telegram", changes.outcome="skipped_no_token"
//     - this FAILS if the TG branch is unreachable (catches the P1 regression)
//
//   Negative: user with channels=["whatsapp"] + telegram_chat_id set →
//     assert NO send_telegram audit row.

const TS = `tgnotify-${Date.now()}`;

// Helper: poll audit_log for a row matching action + event + (optionally) outcome.
// Returns the matching row or null after timeout.
async function pollAuditRow(baseUrl, suToken, action, event, outcome, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    var filterParts = [`action="${action}"`, `changes ~ '"event":"${event}"'`];
    if (outcome) filterParts.push(`changes ~ '"outcome":"${outcome}"'`);
    var filter = filterParts.join(" && ");
    const res = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(filter)}&perPage=200`,
      { headers: { Authorization: suToken } }
    );
    if (res.ok) {
      const body = await res.json();
      if (body.items && body.items.length > 0) return body.items[0];
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

// Helper: count audit rows for a specific (action, event) pair.
async function countAuditRows(baseUrl, suToken, action, event) {
  var filter = `action="${action}" && changes ~ '"event":"${event}"'`;
  const res = await fetch(
    `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(filter)}&perPage=200`,
    { headers: { Authorization: suToken } }
  );
  if (!res.ok) return -1;
  const body = await res.json();
  return body.totalItems ?? body.items?.length ?? 0;
}

describe("tg_notify Phase 6 — request_fulfilled TG branch", () => {
  let baseUrl, suToken;
  // telegram-only user: channels=["telegram"], no phone — the target case
  let tgOnlyUserId;
  // wa-only user: channels=["whatsapp"] + telegram_chat_id — negative gate test
  let waOnlyWithChatId;
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
  async function createUser(email, extraFields = {}) {
    const res = await suPost("/api/collections/users/records", {
      email, password: "Testpass1!", passwordConfirm: "Testpass1!",
      name: email.split("@")[0], role: "user", ...extraFields,
    });
    expect(res.status, `create user ${email}`).toBe(200);
    return (await res.json()).id;
  }

  beforeAll(async () => {
    // TELEGRAM_BOT_TOKEN intentionally NOT set
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Telegram-only user: has telegram in channels, has telegram_chat_id, NO phone
    tgOnlyUserId = await createUser(`${TS}-tgonly@tg.local`, {
      notification_prefs: JSON.stringify({
        channels: ["telegram"],
        events: { request_fulfilled: true, kit_moved: true },
      }),
      telegram_chat_id: "tgonly-chat-111",
    });

    // WA-only user with a telegram_chat_id set — negative gate test
    waOnlyWithChatId = await createUser(`${TS}-waonly@tg.local`, {
      notification_prefs: JSON.stringify({
        channels: ["whatsapp"],
        events: { request_fulfilled: true },
      }),
      telegram_chat_id: "waonly-chat-222",
    });

    const kitRes = await suPost("/api/collections/kits/records", {
      serial: `${TS}-KIT-RF`, is_active: true,
    });
    expect(kitRes.status).toBe(200);
    kitId = (await kitRes.json()).id;

    const entRes = await suPost("/api/collections/entities/records", {
      name: `${TS}-Entity-RF`, category: "field", is_active: true,
    });
    expect(entRes.status).toBe(200);
    entityId = (await entRes.json()).id;
  }, 60_000);

  afterAll(async () => { await stopPb(); });

  // Underlying op always succeeds
  it("approved→fulfilled still returns 200 for telegram-only user (no phone)", async () => {
    const r = await suPost("/api/collections/requests/records", {
      requester: tgOnlyUserId, date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
    });
    const req = await r.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    const res = await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });
    expect(res.status, "approved→fulfilled 200").toBe(200);
    expect((await res.json()).status).toBe("fulfilled");
  });

  // P1 regression guard: TG branch actually ran and wrote audit row
  it("telegram-only user (no phone): audit_log has send_telegram row with outcome=skipped_no_token", async () => {
    const r = await suPost("/api/collections/requests/records", {
      requester: tgOnlyUserId, date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open", designated_kit: kitId, target_entity: entityId,
    });
    const req = await r.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });

    // Branch ran → audit row with outcome=skipped_no_token must appear
    const row = await pollAuditRow(baseUrl, suToken, "send_telegram", "request_fulfilled", "skipped_no_token");
    expect(row, "send_telegram audit row with skipped_no_token must exist (proves branch ran)").not.toBeNull();
    const changes = JSON.parse(row.changes);
    expect(changes.outcome).toBe("skipped_no_token");
    expect(changes.to).toBe("tgonly-chat-111");
    expect(changes.event).toBe("request_fulfilled");
  });

  // Negative gate: channels=["whatsapp"] user with telegram_chat_id → NO send_telegram row
  it("wa-only user with telegram_chat_id: no send_telegram audit row written", async () => {
    const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_fulfilled");

    const r = await suPost("/api/collections/requests/records", {
      requester: waOnlyWithChatId, date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
    });
    const req = await r.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });

    // Give hooks a moment to execute (they're synchronous in the hook but we want to
    // be sure any async audit writes have committed before counting)
    await new Promise(r => setTimeout(r, 500));

    const after = await countAuditRows(baseUrl, suToken, "send_telegram", "request_fulfilled");
    expect(after, "no new send_telegram rows for wa-only user").toBe(before);
  });
});

describe("tg_notify Phase 6 — request_pending TG branch (admin notification)", () => {
  let baseUrl, suToken, adminToken, adminId;
  let requesterTgOnly;

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
    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0]?.id;
    expect(adminId, "seeded admin must exist").toBeTruthy();

    // Telegram-only requester (just to have someone making requests)
    const rRes = await suPost("/api/collections/users/records", {
      email: `${TS}-rp-requester@tg.local`,
      password: "Testpass1!", passwordConfirm: "Testpass1!",
      name: "RP Requester", role: "user",
    });
    expect(rRes.status).toBe(200);
    requesterTgOnly = (await rRes.json()).id;
  }, 60_000);

  afterAll(async () => { await stopPb(); });

  // P1 regression guard: telegram-only admin (no phone) gets audit row
  it("telegram-only admin (no phone): send_telegram audit row written with outcome=skipped_no_token", async () => {
    // Set admin to telegram-only, no phone
    await suPatch(`/api/collections/users/records/${adminId}`, {
      phone: "",
      telegram_chat_id: "admin-tgonly-chat-999",
      notification_prefs: JSON.stringify({
        channels: ["telegram"],
        events: { request_pending: true },
      }),
    });

    try {
      const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_pending");

      const res = await suPost("/api/collections/requests/records", {
        requester: requesterTgOnly, date: new Date().toISOString(),
        delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
      });
      expect(res.status, "create request 200").toBe(200);

      // Branch ran → audit row with outcome=skipped_no_token must appear
      const row = await pollAuditRow(baseUrl, suToken, "send_telegram", "request_pending", "skipped_no_token");
      expect(row, "send_telegram audit row must exist for telegram-only admin").not.toBeNull();
      const changes = JSON.parse(row.changes);
      expect(changes.outcome).toBe("skipped_no_token");
      expect(changes.to).toBe("admin-tgonly-chat-999");
    } finally {
      await suPatch(`/api/collections/users/records/${adminId}`, {
        phone: "", telegram_chat_id: "", notification_prefs: "",
      });
    }
  });

  // Negative: admin with channels=["whatsapp"] + telegram_chat_id → no send_telegram row
  it("wa-only admin with telegram_chat_id: no send_telegram audit row written", async () => {
    await suPatch(`/api/collections/users/records/${adminId}`, {
      phone: "+15550001111",
      telegram_chat_id: "admin-waonly-chat-888",
      notification_prefs: JSON.stringify({
        channels: ["whatsapp"],
        events: { request_pending: true },
      }),
    });

    try {
      const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_pending");

      await suPost("/api/collections/requests/records", {
        requester: requesterTgOnly, date: new Date().toISOString(),
        delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
      });

      await new Promise(r => setTimeout(r, 500));

      const after = await countAuditRows(baseUrl, suToken, "send_telegram", "request_pending");
      expect(after, "no new send_telegram rows for wa-only admin").toBe(before);
    } finally {
      await suPatch(`/api/collections/users/records/${adminId}`, {
        phone: "", telegram_chat_id: "", notification_prefs: "",
      });
    }
  });
});

describe("tg_notify Phase 6 — escalation TG branch (/_test/ route)", () => {
  let baseUrl, suToken, adminToken, adminId;
  let requesterId;

  beforeAll(async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test_phone_id";
    process.env.WHATSAPP_TOKEN = "test_token";
    // TELEGRAM_BOT_TOKEN intentionally NOT set — sends degrade to skipped_no_token

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;
    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0]?.id;
    expect(adminId, "seeded admin must exist").toBeTruthy();

    const rRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${TS}-esc-requester@tg.local`,
        password: "Userpass1!", passwordConfirm: "Userpass1!",
        role: "user", name: "ESC Requester",
      }),
    });
    expect(rRes.status).toBe(200);
    requesterId = (await rRes.json()).id;
  }, 60_000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  async function trigger(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${baseUrl}/_test/wa-approval-escalation${qs ? "?" + qs : ""}`, {
      method: "POST",
      headers: { Authorization: adminToken },
    });
  }
  async function createOpenRequest() {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: requesterId, date: today, delivery_date: today, status: "open" }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).id;
  }
  async function deleteRequest(id) {
    await fetch(`${baseUrl}/api/collections/requests/records/${id}`, {
      method: "DELETE", headers: { Authorization: suToken },
    });
  }
  async function patchAdmin(fields) {
    await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  // P1 regression guard: telegram-only admin (no phone) gets audit row from /_test/ route
  it("telegram-only admin (no phone): /_test/ route writes send_telegram audit row with outcome=skipped_no_token", async () => {
    await patchAdmin({
      phone: "",
      telegram_chat_id: "esc-tgonly-chat-777",
      notification_prefs: JSON.stringify({
        channels: ["telegram"],
        events: { request_escalation: true },
      }),
    });
    const reqId = await createOpenRequest();
    try {
      const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_escalation");

      const res = await trigger({ threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);

      // TG branch ran → audit row written
      const row = await pollAuditRow(baseUrl, suToken, "send_telegram", "request_escalation", "skipped_no_token");
      expect(row, "send_telegram audit row must exist for telegram-only admin in escalation").not.toBeNull();
      const changes = JSON.parse(row.changes);
      expect(changes.outcome).toBe("skipped_no_token");
      expect(changes.to).toBe("esc-tgonly-chat-777");
      // tg_sent reflects the count in this run
      expect(body.tg_sent).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteRequest(reqId);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });

  // Negative: wa-only admin with telegram_chat_id → no send_telegram row from escalation
  it("wa-only admin with telegram_chat_id: escalation writes no send_telegram row", async () => {
    await patchAdmin({
      phone: "+15551112222",
      telegram_chat_id: "esc-waonly-chat-666",
      notification_prefs: JSON.stringify({
        channels: ["whatsapp"],
        events: { request_escalation: true },
      }),
    });
    const reqId = await createOpenRequest();
    try {
      const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_escalation");
      const res = await trigger({ threshold_hours: "0" });
      expect(res.status).toBe(200);

      await new Promise(r => setTimeout(r, 500));
      const after = await countAuditRows(baseUrl, suToken, "send_telegram", "request_escalation");
      expect(after, "no new send_telegram rows for wa-only admin").toBe(before);
    } finally {
      await deleteRequest(reqId);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });

  // Dedup: test with a phone admin (WA eligible) so escalation actually fires and dedup is exercised.
  // When TG token is unset, TG-only admin gets skipped_no_token which does NOT mark escalated
  // (Fix 2 — retry semantics). Use phone admin for the dedup path instead.
  it("dedup still works: second trigger for same request returns already_escalated>=1", async () => {
    await patchAdmin({
      phone: "+15559991111",
      telegram_chat_id: "esc-dedup-chat-555",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp"],
        events: { request_escalation: true },
      }),
    });
    const reqId = await createOpenRequest();
    try {
      const res1 = await trigger({ threshold_hours: "0" });
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      // WA eligible (phone set + WA creds set in beforeAll) → escalated >= 1
      expect(body1.escalated).toBeGreaterThanOrEqual(1);

      const res2 = await trigger({ threshold_hours: "0" });
      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(body2.already_escalated).toBeGreaterThanOrEqual(1);
      expect(body2.escalated).toBe(0);
    } finally {
      await deleteRequest(reqId);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });

  // Admin with both phone + telegram → both WA and TG eligible
  it("admin with phone + telegram: escalated >= 1, tg_sent >= 1", async () => {
    await patchAdmin({
      phone: "+15559876543",
      telegram_chat_id: "esc-both-chat-444",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp"],
        events: { request_escalation: true },
      }),
    });
    const reqId = await createOpenRequest();
    try {
      const res = await trigger({ threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fired).toBe(true);
      expect(body.escalated).toBeGreaterThanOrEqual(1);
      expect(body.tg_sent).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteRequest(reqId);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });

  // Event opt-out: request_escalation=false blocks both WA and TG
  it("request_escalation=false: escalated=0, no tg_sent", async () => {
    await patchAdmin({
      phone: "+15550000001",
      telegram_chat_id: "esc-optout-chat-333",
      notification_prefs: JSON.stringify({
        channels: ["telegram", "whatsapp"],
        events: { request_escalation: false },
      }),
    });
    const reqId = await createOpenRequest();
    try {
      const res = await trigger({ threshold_hours: "0" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.escalated).toBe(0);
      expect(body.tg_sent).toBe(0);
    } finally {
      await deleteRequest(reqId);
      await patchAdmin({ phone: "", telegram_chat_id: "", notification_prefs: "" });
    }
  });
});
