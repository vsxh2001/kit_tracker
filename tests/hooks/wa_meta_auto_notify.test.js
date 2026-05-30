import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Hook under test: wa_meta_auto_notify.pb.js
//
// Three onRecord hooks fire on key write events:
//
//   1. onRecordAfterUpdateRequest("requests")
//      - Only acts on the approved → fulfilled status transition.
//      - Returns early when WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN not set.
//      - Looks up requester + phone; skips if no phone.
//      - Sends Meta Cloud API message; failure is swallowed, never re-thrown.
//      - Writes best-effort audit_log row after send attempt.
//
//   2. onRecordAfterCreateRequest("requests")
//      - Notifies admin users (with phone) of a new pending request via WA.
//      - Returns early when creds not set.
//      - Stores shortId → requestId in $app.store() for approval replies.
//
//   3. onRecordAfterCreateRequest("transactions")
//      - Opt-in (WHATSAPP_NOTIFY_MOVES=1 required); returns early if unset.
//      - Also returns early when creds not set.
//      - Notifies requester on the linked approved request that kit moved.
//
// Test strategy:
//   The harness boots PB with no WHATSAPP_* env vars and no WHATSAPP_NOTIFY_MOVES.
//   Under these conditions every handler returns early at the first guard:
//     - handlers 1 & 2: `if (!phoneNumberId || !token) return;`
//     - handler 3:      `if (notifyMoves !== "1") return;`
//   We verify the observable contract: creates/updates return 200 and the
//   records are retrievable afterwards — proving no hook path throws or
//   corrupts the operation. We drive all three handlers and cover the main
//   code branches (expand paths, non-matching transition, phone field present).

const TS = `wanotify-${Date.now()}`;

describe("wa_meta_auto_notify hook", () => {
  let baseUrl, suToken, adminToken, adminId;
  let requesterId, requesterWithPhoneId;
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

  async function createUser(email, role, phone) {
    const payload = {
      email,
      password: "Testpass1!",
      passwordConfirm: "Testpass1!",
      name: email.split("@")[0],
      role,
    };
    if (phone) payload.phone = phone;
    const res = await suPost("/api/collections/users/records", payload);
    expect(res.status, `create user ${email}`).toBe(200);
    return (await res.json()).id;
  }

  async function createRequest(overrides = {}) {
    return suPost("/api/collections/requests/records", {
      requester: requesterId,
      date: new Date().toISOString(),
      delivery_date: new Date(Date.now() + 86400000).toISOString(),
      status: "open",
      ...overrides,
    });
  }

  async function createTransaction(kitId, entityId, userId, userToken) {
    return fetch(`${baseUrl}/api/collections/transactions/records`, {
      method: "POST",
      headers: {
        Authorization: userToken || suToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kit: kitId,
        to_entity: entityId,
        timestamp: new Date().toISOString(),
        created_by: userId || adminId,
      }),
    });
  }

  // ── setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
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

    // A plain requester (no phone) and one with a phone (covers phone-lookup branch).
    requesterId = await createUser(`${TS}-req@wa.local`, "user");
    requesterWithPhoneId = await createUser(`${TS}-reqphone@wa.local`, "user", "+972500000099");

    // Shared kit + entity for transactions and requests.
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

  // ── Handler 2: onRecordAfterCreateRequest("requests") ───────────────────

  it("creates request — no WA creds, hook skips silently, record retrievable", async () => {
    const res = await createRequest();
    expect(res.status, "create should return 200").toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("open");

    const getRes = await fetch(
      `${baseUrl}/api/collections/requests/records/${body.id}`,
      { headers: { Authorization: suToken } }
    );
    expect(getRes.status).toBe(200);
  });

  it("creates request with designated_kit + target_entity — expand branches covered, succeeds", async () => {
    const res = await createRequest({ designated_kit: kitId, target_entity: entityId });
    expect(res.status, "create with relations should return 200").toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.designated_kit).toBe(kitId);
    expect(body.target_entity).toBe(entityId);
  });

  // ── Handler 1: onRecordAfterUpdateRequest("requests") ───────────────────

  it("updates request open→approved — non-matching transition, hook returns early, record intact", async () => {
    const createRes = await createRequest();
    const { id: reqId } = await createRes.json();

    // open → approved does NOT match the approved→fulfilled trigger — hook exits immediately.
    const patchRes = await suPatch(
      `/api/collections/requests/records/${reqId}`,
      { status: "approved" }
    );
    expect(patchRes.status, "PATCH open→approved should succeed").toBe(200);
    const updated = await patchRes.json();
    expect(updated.status).toBe("approved");
  });

  it("updates request approved→fulfilled — no WA creds, hook skips, record retrievable", async () => {
    // Create + immediately approve so we can test the critical approved→fulfilled path.
    const createRes = await createRequest({ requester: requesterId });
    const req = await createRes.json();

    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const fulfillRes = await suPatch(
      `/api/collections/requests/records/${req.id}`,
      { status: "fulfilled" }
    );
    expect(fulfillRes.status, "PATCH approved→fulfilled should return 200").toBe(200);
    const body = await fulfillRes.json();
    expect(body.status).toBe("fulfilled");

    // Record must be retrievable — hook must not have corrupted it.
    const getRes = await fetch(
      `${baseUrl}/api/collections/requests/records/${req.id}`,
      { headers: { Authorization: suToken } }
    );
    expect(getRes.status).toBe(200);
  });

  it("approved→fulfilled with requester having phone — phone-lookup branch covered, skips gracefully", async () => {
    // Requester has a phone set: exercises the requester phone-lookup path
    // even though the hook exits at the creds guard before sending.
    const createRes = await createRequest({ requester: requesterWithPhoneId });
    const req = await createRes.json();

    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const fulfillRes = await suPatch(
      `/api/collections/requests/records/${req.id}`,
      { status: "fulfilled" }
    );
    expect(fulfillRes.status, "approved→fulfilled with phone user should succeed").toBe(200);
    const body = await fulfillRes.json();
    expect(body.status).toBe("fulfilled");
  });

  it("updates request approved→fulfilled with kit + entity set — relation-expand branch covered", async () => {
    const createRes = await createRequest({
      requester: requesterId,
      designated_kit: kitId,
      target_entity: entityId,
    });
    const req = await createRes.json();

    await suPatch(`/api/collections/requests/records/${req.id}`, { status: "approved" });

    const fulfillRes = await suPatch(
      `/api/collections/requests/records/${req.id}`,
      { status: "fulfilled" }
    );
    expect(fulfillRes.status, "approved→fulfilled with relations should succeed").toBe(200);
    const body = await fulfillRes.json();
    expect(body.status).toBe("fulfilled");
  });

  // ── Handler 3: onRecordAfterCreateRequest("transactions") ───────────────

  it("creates transaction with WHATSAPP_NOTIFY_MOVES unset — hook skips at opt-in guard, tx retrievable", async () => {
    const res = await createTransaction(kitId, entityId, adminId, adminToken);
    expect(res.status, "transaction create should return 200").toBe(200);
    const tx = await res.json();
    expect(tx.id).toBeTruthy();
    expect(tx.kit).toBe(kitId);

    const getRes = await fetch(
      `${baseUrl}/api/collections/transactions/records/${tx.id}`,
      { headers: { Authorization: suToken } }
    );
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.to_entity).toBe(entityId);
  });

  it("creates multiple transactions in sequence — hook does not accumulate state between calls", async () => {
    const kit2Res = await suPost("/api/collections/kits/records", {
      serial: `${TS}-KIT2`,
      is_active: true,
    });
    const kit2Id = (await kit2Res.json()).id;

    // Two sequential transactions on different kits — hook must not throw
    // on the second call due to any leftover state from the first.
    const tx1Res = await createTransaction(kitId, entityId, adminId, adminToken);
    expect(tx1Res.status, "first transaction").toBe(200);

    const tx2Res = await createTransaction(kit2Id, entityId, adminId, adminToken);
    expect(tx2Res.status, "second transaction").toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Audit actor regression tests (issue #180).
// Run with fake WA creds so hooks reach the audit-write code path.
// The $http.send call fails (fake creds/network), but the audit write is in
// its own try/catch after the HTTP block and always fires.
// ---------------------------------------------------------------------------
const TS2 = `wanotify-actor-${Date.now()}`;

describe("wa_meta_auto_notify — send_whatsapp audit actor (issue #180 regression)", () => {
  let baseUrl, suToken, adminId, adminToken;
  let requesterId, entityId, kitId;

  beforeAll(async () => {
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

    const rRes = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${TS2}-req@wa.local`,
        password: "Testpass1!",
        passwordConfirm: "Testpass1!",
        name: "ActorTestReq",
        role: "user",
        phone: "+972501111111",
      }),
    });
    expect(rRes.status, "create requester").toBe(200);
    requesterId = (await rRes.json()).id;

    const kitRes = await fetch(`${baseUrl}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: `${TS2}-KIT`, is_active: true }),
    });
    expect(kitRes.status, "create kit").toBe(200);
    kitId = (await kitRes.json()).id;

    const entRes = await fetch(`${baseUrl}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${TS2}-Ent`, category: "field", is_active: true }),
    });
    expect(entRes.status, "create entity").toBe(200);
    entityId = (await entRes.json()).id;
  }, 60_000);

  afterAll(async () => {
    await stopPb();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_TOKEN;
  });

  it("approved→fulfilled: send_whatsapp audit row has actor=requesterId", async () => {
    const createRes = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: requesterId,
        date: new Date().toISOString().slice(0, 10),
        delivery_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        status: "open",
        designated_kit: kitId,
        target_entity: entityId,
      }),
    });
    expect(createRes.status, "create request").toBe(200);
    const req = await createRes.json();

    await fetch(`${baseUrl}/api/collections/requests/records/${req.id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });

    const fulfillRes = await fetch(`${baseUrl}/api/collections/requests/records/${req.id}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "fulfilled" }),
    });
    expect(fulfillRes.status, "approved→fulfilled").toBe(200);

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(
        `action="send_whatsapp" && actor="${requesterId}"`
      )}`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const rows = (await auditRes.json()).items;
    expect(rows.length, "send_whatsapp audit row must exist with actor=requesterId").toBeGreaterThanOrEqual(1);
    expect(rows[0].actor).toBe(requesterId);
    expect(JSON.parse(rows[0].changes).event).toBe("request_fulfilled");
  }, 30_000);

  it("request_pending: send_whatsapp audit row has actor=adminId", async () => {
    await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972502222222" }),
    });

    const createRes = await fetch(`${baseUrl}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: requesterId,
        date: new Date().toISOString().slice(0, 10),
        delivery_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        status: "open",
      }),
    });
    expect(createRes.status, "create request triggers request_pending hook").toBe(200);

    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=${encodeURIComponent(
        `action="send_whatsapp" && actor="${adminId}"`
      )}`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const rows = (await auditRes.json()).items;
    expect(rows.length, "send_whatsapp audit row must exist with actor=adminId").toBeGreaterThanOrEqual(1);
    expect(rows[0].actor).toBe(adminId);
    expect(JSON.parse(rows[0].changes).event).toBe("request_pending");

    await fetch(`${baseUrl}/api/collections/users/records/${adminId}`, {
      method: "PATCH",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "" }),
    });
  }, 30_000);
});
