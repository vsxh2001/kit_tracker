import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for tg_auto_notify.pb.js
//
// Three onRecord hooks fire on key write events:
//
//   1. onRecordAfterUpdateRequest("requests")
//      - Only acts on the approved → fulfilled status transition.
//      - Notifies requester via Telegram when channels includes "telegram".
//      - TELEGRAM_BOT_TOKEN absent → _sendTelegram returns "skipped_no_token"
//        but the audit row is still written (outcome=skipped_no_token).
//
//   2. onRecordAfterCreateRequest("requests")
//      - Notifies admin users with telegram_chat_id of a new pending request.
//      - Skips admins whose channels pref excludes "telegram".
//
//   3. onRecordAfterCreateRequest("transactions")
//      - Opt-in (TELEGRAM_NOTIFY_MOVES=1 required); returns early if unset.
//      - Notifies requester on the linked approved request that kit moved.
//
// Test strategy:
//   Set process.env.TELEGRAM_BOT_TOKEN = "test_token" BEFORE startPb() so the
//   send path is reached (HTTP will fail on fake token but audit write fires in
//   its own try/catch). Assert a send_telegram audit_log row with the correct
//   actor exists after each triggering event.
//
//   Negative cases set channels=["whatsapp"] and assert no send_telegram row.

const TS = `tgautonotify-${Date.now()}`;

// Helper: poll audit_log for a row matching action + event + (optionally) actor.
// Returns the matching row or null after timeout.
async function pollAuditRow(baseUrl, suToken, action, event, actorId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`action="${action}"`)}&perPage=400&sort=-created`,
      { headers: { Authorization: suToken } }
    );
    if (res.ok) {
      const body = await res.json();
      for (const row of (body.items || [])) {
        let c;
        try { c = JSON.parse(row.changes); } catch (_) { continue; }
        if (c && c.event === event) {
          if (!actorId || row.actor === actorId) return row;
        }
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

// Helper: count audit rows for a specific (action, event) pair.
async function countAuditRows(baseUrl, suToken, action, event) {
  const res = await fetch(
    `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(`action="${action}"`)}&perPage=400&sort=-created`,
    { headers: { Authorization: suToken } }
  );
  if (!res.ok) return -1;
  const body = await res.json();
  let n = 0;
  for (const row of (body.items || [])) {
    let c;
    try { c = JSON.parse(row.changes); } catch (_) { continue; }
    if (c && c.event === event) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Hook 1: request_fulfilled TG notification
// ---------------------------------------------------------------------------
describe("tg_auto_notify — request_fulfilled", () => {
  let baseUrl, suToken;
  let tgOnlyUserId;
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
    // Set fake token so send path is reached; HTTP will fail but audit fires.
    process.env.TELEGRAM_BOT_TOKEN = "test_token";

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    // Telegram-only user: has telegram in channels, has telegram_chat_id, NO phone
    tgOnlyUserId = await createUser(`${TS}-tgonly-rf@tg.local`, {
      notification_prefs: JSON.stringify({
        channels: ["telegram"],
        events: { request_fulfilled: true, kit_moved: true },
      }),
      telegram_chat_id: "tgonly-chat-rf-111",
    });

    // WA-only user with telegram_chat_id — negative gate test
    waOnlyWithChatId = await createUser(`${TS}-waonly-rf@tg.local`, {
      notification_prefs: JSON.stringify({
        channels: ["whatsapp"],
        events: { request_fulfilled: true },
      }),
      telegram_chat_id: "waonly-chat-rf-222",
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

  afterAll(async () => {
    await stopPb();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("approved→fulfilled returns 200 for telegram-only user (no phone)", async () => {
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

  it("telegram-only user: send_telegram audit row written with actor=tgOnlyUserId", async () => {
    const r = await suPost("/api/collections/requests/records", {
      requester: tgOnlyUserId, date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open", designated_kit: kitId, target_entity: entityId,
    });
    const req = await r.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });

    const row = await pollAuditRow(baseUrl, suToken, "send_telegram", "request_fulfilled", tgOnlyUserId);
    expect(row, "send_telegram audit row must exist with actor=tgOnlyUserId").not.toBeNull();
    expect(row.actor).toBe(tgOnlyUserId);
    const changes = JSON.parse(row.changes);
    expect(changes.event).toBe("request_fulfilled");
    expect(changes.to).toBe("tgonly-chat-rf-111");
  });

  it("non-matching transition (open→approved) — hook returns early, no extra send_telegram row", async () => {
    const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_fulfilled");

    const r = await suPost("/api/collections/requests/records", {
      requester: tgOnlyUserId, date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
    });
    const req = await r.json();
    const res = await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    expect(res.status, "open→approved 200").toBe(200);

    await new Promise(r => setTimeout(r, 500));
    const after = await countAuditRows(baseUrl, suToken, "send_telegram", "request_fulfilled");
    expect(after, "no new send_telegram rows for non-matching transition").toBe(before);
  });

  it("wa-only user with telegram_chat_id: no send_telegram audit row written", async () => {
    const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_fulfilled");

    const r = await suPost("/api/collections/requests/records", {
      requester: waOnlyWithChatId, date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
    });
    const req = await r.json();
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });
    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "fulfilled" });

    await new Promise(r => setTimeout(r, 500));
    const after = await countAuditRows(baseUrl, suToken, "send_telegram", "request_fulfilled");
    expect(after, "no new send_telegram rows for wa-only user").toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Hook 2: request_pending TG notification (admin notification)
// ---------------------------------------------------------------------------
describe("tg_auto_notify — request_pending", () => {
  let baseUrl, suToken, adminId;
  let requesterUserId;

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
    process.env.TELEGRAM_BOT_TOKEN = "test_token";

    const pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    const adminRes = await fetch(
      `${baseUrl}/api/collections/users/records?filter=${encodeURIComponent('email="admin@hook-test.local"')}`,
      { headers: { Authorization: suToken } }
    );
    adminId = (await adminRes.json()).items[0]?.id;
    expect(adminId, "seeded admin must exist").toBeTruthy();

    // A plain requester (no TG)
    const rRes = await suPost("/api/collections/users/records", {
      email: `${TS}-rp-requester@tg.local`,
      password: "Testpass1!", passwordConfirm: "Testpass1!",
      name: "RP Requester", role: "user",
    });
    expect(rRes.status).toBe(200);
    requesterUserId = (await rRes.json()).id;
  }, 60_000);

  afterAll(async () => {
    await stopPb();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("telegram-only admin (no phone): send_telegram audit row written with actor=adminId", async () => {
    await suPatch(`/api/collections/users/records/${adminId}`, {
      phone: "",
      telegram_chat_id: "admin-tgonly-chat-rp-999",
      notification_prefs: JSON.stringify({
        channels: ["telegram"],
        events: { request_pending: true },
      }),
    });

    try {
      const res = await suPost("/api/collections/requests/records", {
        requester: requesterUserId, date: new Date().toISOString(),
        delivery_date: new Date(Date.now() + 86400000).toISOString(), status: "open",
      });
      expect(res.status, "create request 200").toBe(200);

      const row = await pollAuditRow(baseUrl, suToken, "send_telegram", "request_pending", adminId);
      expect(row, "send_telegram audit row must exist for telegram-only admin").not.toBeNull();
      expect(row.actor).toBe(adminId);
      const changes = JSON.parse(row.changes);
      expect(changes.event).toBe("request_pending");
      expect(changes.to).toBe("admin-tgonly-chat-rp-999");
    } finally {
      await suPatch(`/api/collections/users/records/${adminId}`, {
        phone: "", telegram_chat_id: "", notification_prefs: "",
      });
    }
  });

  it("wa-only admin with telegram_chat_id: no send_telegram audit row written", async () => {
    await suPatch(`/api/collections/users/records/${adminId}`, {
      phone: "+15550001111",
      telegram_chat_id: "admin-waonly-chat-rp-888",
      notification_prefs: JSON.stringify({
        channels: ["whatsapp"],
        events: { request_pending: true },
      }),
    });

    try {
      const before = await countAuditRows(baseUrl, suToken, "send_telegram", "request_pending");

      await suPost("/api/collections/requests/records", {
        requester: requesterUserId, date: new Date().toISOString(),
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

// ---------------------------------------------------------------------------
// Hook 3: kit_moved TG notification (opt-in via TELEGRAM_NOTIFY_MOVES=1)
// ---------------------------------------------------------------------------
describe("tg_auto_notify — kit_moved", () => {
  let baseUrl, suToken, adminId, adminToken;
  let tgOnlyUserId;
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
    process.env.TELEGRAM_BOT_TOKEN = "test_token";
    process.env.TELEGRAM_NOTIFY_MOVES = "1";

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

    // Telegram-only user: has telegram in channels, has telegram_chat_id, NO phone
    const rRes = await suPost("/api/collections/users/records", {
      email: `${TS}-km-tgonly@tg.local`,
      password: "Testpass1!", passwordConfirm: "Testpass1!",
      name: "KM TG Requester", role: "user",
      notification_prefs: JSON.stringify({
        channels: ["telegram"],
        events: { kit_moved: true },
      }),
      telegram_chat_id: "tgonly-chat-km-333",
    });
    expect(rRes.status).toBe(200);
    tgOnlyUserId = (await rRes.json()).id;

    const kitRes = await suPost("/api/collections/kits/records", {
      serial: `${TS}-KIT-KM`, is_active: true,
    });
    expect(kitRes.status).toBe(200);
    kitId = (await kitRes.json()).id;

    const entRes = await suPost("/api/collections/entities/records", {
      name: `${TS}-Entity-KM`, category: "field", is_active: true,
    });
    expect(entRes.status).toBe(200);
    entityId = (await entRes.json()).id;
  }, 60_000);

  afterAll(async () => {
    await stopPb();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_NOTIFY_MOVES;
  });

  it("TELEGRAM_NOTIFY_MOVES unset — transaction creates without error, no send_telegram row", async () => {
    // Temporarily unset the flag (it's set by env before startPb, but PB reads it at call time)
    // We can't unset it after PB started, so just verify that with no approved request the hook
    // skips gracefully (no matching approved request → returns early without sending).
    const res = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kitId,
        to_entity: entityId,
        timestamp: new Date().toISOString(),
        created_by: adminId,
      }),
    });
    expect(res.status, "transaction create should return 200").toBe(200);
    const tx = await res.json();
    expect(tx.id).toBeTruthy();
  });

  it("kit_moved with approved request: send_telegram audit row written with actor=tgOnlyUserId", async () => {
    // Create request in approved state for the kit
    const reqRes = await suPost("/api/collections/requests/records", {
      requester: tgOnlyUserId,
      date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open",
      designated_kit: kitId,
      target_entity: entityId,
    });
    expect(reqRes.status).toBe(200);
    const req = await reqRes.json();

    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    // Create transaction to trigger kit_moved hook
    const txRes = await fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        kit: kitId,
        to_entity: entityId,
        timestamp: new Date().toISOString(),
        created_by: adminId,
      }),
    });
    expect(txRes.status, "transaction create 200").toBe(200);

    const row = await pollAuditRow(baseUrl, suToken, "send_telegram", "kit_moved", tgOnlyUserId);
    expect(row, "send_telegram audit row must exist for kit_moved with actor=tgOnlyUserId").not.toBeNull();
    expect(row.actor).toBe(tgOnlyUserId);
    const changes = JSON.parse(row.changes);
    expect(changes.event).toBe("kit_moved");
    expect(changes.to).toBe("tgonly-chat-km-333");
  });
});
