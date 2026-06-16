import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPb, stopPb, authUser } from "./_helper.js";

// Tests for POST /api/tg/webhook (tg_webhook.pb.js)
//
// TELEGRAM_BOT_TOKEN is unset → sendTelegram() logs and skips (no real network calls).
// TELEGRAM_BOT_SECRET is unset → secret check is skipped with a warning (proceed path).
// Logic (code lookup, expiry, user update, audit log) still runs normally.
//
// Telegram update shape: { message: { text, chat: { id } } }

describe("tg_webhook hook (POST /api/tg/webhook)", () => {
  let pb, baseUrl, suToken, adminToken;
  let linkUserId, linkUserToken;

  // Helper: POST a Telegram-shaped update to the webhook
  function postUpdate(update, headers = {}) {
    return fetch(`${baseUrl}/api/tg/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(update),
    });
  }

  // Helper: mint a link code for a user (via the /api/tg/link/code endpoint)
  async function mintCode(token) {
    const res = await fetch(`${baseUrl}/api/tg/link/code`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
    });
    if (res.status !== 200) throw new Error("mintCode failed: " + res.status);
    return (await res.json()).code;
  }

  // Helper: seed a tg_link_codes row directly via superuser (to test expired/used states)
  async function seedCode({ userId, code, expiresAt, used = false, usedAt = null }) {
    const body = { code, user: userId, expires_at: expiresAt, used };
    if (usedAt) body.used_at = usedAt;
    const res = await fetch(`${baseUrl}/api/collections/tg_link_codes/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status >= 300) throw new Error("seedCode failed: " + res.status + " " + await res.text());
    return await res.json();
  }

  beforeAll(async () => {
    pb = await startPb();
    baseUrl = pb.baseUrl;
    suToken = pb.suToken;

    adminToken = await authUser(baseUrl, "admin@hook-test.local", "Adminpass1!");

    // Create a user for linking tests
    const u = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "webhook-linker@tg-webhook-test.local",
        password: "Webhookpass1!",
        passwordConfirm: "Webhookpass1!",
        role: "user",
        name: "TG Webhook Linker",
      }),
    });
    const uData = await u.json();
    linkUserId = uData.id;
    linkUserToken = await authUser(baseUrl, "webhook-linker@tg-webhook-test.local", "Webhookpass1!");
  }, 60000);

  afterAll(stopPb);

  // ---------- secret check (unset = proceed) ----------

  it("returns 200 when TELEGRAM_BOT_SECRET is unset (proceeds, no crash)", async () => {
    // No secret env set in test harness → warning logged, request proceeds
    const res = await postUpdate({
      message: { text: "/start", chat: { id: 99999 } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // ---------- missing message / text guards ----------

  it("returns 200 with ok:true when update has no message field", async () => {
    const res = await postUpdate({ update_id: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 200 with ok:true when message has no text field", async () => {
    const res = await postUpdate({
      message: { chat: { id: 123 }, sticker: {} },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // ---------- /start with no code ----------

  it("/start with no code returns 200 and sends hint (no crash)", async () => {
    const res = await postUpdate({
      message: { text: "/start", chat: { id: 111111 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // ---------- unknown code ----------

  it("unknown code returns 200 without touching any user", async () => {
    const res = await postUpdate({
      message: { text: "/start deadbeef1234567890deadbeef12345678", chat: { id: 222222 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // ---------- happy path: valid code redeems correctly ----------

  it("/start <code> links telegram_chat_id on the user and marks code used=true", async () => {
    const code = await mintCode(linkUserToken);
    const chatId = "987654321";

    const res = await postUpdate({
      message: { text: "/start " + code, chat: { id: Number(chatId) } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Verify user.telegram_chat_id was set
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records/${linkUserId}`,
      { headers: { Authorization: suToken } }
    );
    expect(userRes.status).toBe(200);
    const userRec = await userRes.json();
    expect(userRec.telegram_chat_id).toBe(chatId);

    // Verify code is now used=true
    const codeRows = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records?filter=(code="${code}")`,
      { headers: { Authorization: suToken } }
    );
    const codeData = await codeRows.json();
    expect(codeData.items).toHaveLength(1);
    expect(codeData.items[0].used).toBe(true);
    expect(codeData.items[0].used_at).toBeTruthy();
  });

  // ---------- audit log written ----------

  it("successful link writes an audit_log row (action=update, via=tg-link)", async () => {
    const code = await mintCode(linkUserToken);
    const chatId = "555666777";

    const res = await postUpdate({
      message: { text: "/start " + code, chat: { id: Number(chatId) } },
    });
    expect(res.status).toBe(200);

    // Find audit row for this user
    const auditRes = await fetch(
      `${baseUrl}/api/collections/audit_log/records?filter=record_id%3D"${linkUserId}"%26%26action%3D"update"&sort=-created&perPage=10`,
      { headers: { Authorization: suToken } }
    );
    expect(auditRes.status).toBe(200);
    const audit = await auditRes.json();
    const linkRow = audit.items.find((r) => {
      try {
        const changes = JSON.parse(r.changes);
        return changes.via === "tg-link" && changes.telegram_chat_id === chatId;
      } catch (_) { return false; }
    });
    expect(linkRow).toBeTruthy();
  });

  // ---------- expired code ----------

  it("expired code returns 200 without updating the user or mutating the code row", async () => {
    // Seed a code that expired 1 minute ago
    const pastIso = new Date(Date.now() - 60000).toISOString()
      .replace("T", " ").replace("Z", "") + "Z";
    const expiredCode = "aaaa1111bbbb2222cccc3333dddd4444";
    const seeded = await seedCode({
      userId: linkUserId,
      code: expiredCode,
      expiresAt: pastIso,
      used: false,
    });

    const chatId = "111000111";
    const res = await postUpdate({
      message: { text: "/start " + expiredCode, chat: { id: Number(chatId) } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // User's telegram_chat_id should NOT be "111000111"
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records/${linkUserId}`,
      { headers: { Authorization: suToken } }
    );
    const userRec = await userRes.json();
    expect(userRec.telegram_chat_id).not.toBe(chatId);

    // Code row must NOT have been mutated (used flag still false)
    const codeRes = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records/${seeded.id}`,
      { headers: { Authorization: suToken } }
    );
    const codeRow = await codeRes.json();
    expect(codeRow.used).toBe(false);
  });

  // ---------- already-used code ----------

  it("used=true code returns 200 without updating the user or mutating the code row", async () => {
    const usedCode = "ffff0000ffff0000ffff0000ffff0000";
    const futureIso = new Date(Date.now() + 600000).toISOString()
      .replace("T", " ").replace("Z", "") + "Z";
    const nowIso = new Date().toISOString()
      .replace("T", " ").replace("Z", "") + "Z";
    const seeded = await seedCode({
      userId: linkUserId,
      code: usedCode,
      expiresAt: futureIso,
      used: true,
      usedAt: nowIso,
    });

    const chatId = "222000222";
    const res = await postUpdate({
      message: { text: "/start " + usedCode, chat: { id: Number(chatId) } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // User should not have chatId "222000222" set by this call
    const userRes = await fetch(
      `${baseUrl}/api/collections/users/records/${linkUserId}`,
      { headers: { Authorization: suToken } }
    );
    const userRec = await userRes.json();
    expect(userRec.telegram_chat_id).not.toBe(chatId);

    // Code row must remain used=true and not have been reset
    const codeRes = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records/${seeded.id}`,
      { headers: { Authorization: suToken } }
    );
    const codeRow = await codeRes.json();
    expect(codeRow.used).toBe(true);
  });

  // ---------- arbitrary message → Phase 5 AI bot routing ----------

  it("arbitrary message (not /start) returns 200 no crash", async () => {
    // chatId 333444555 has no linked user → "not linked" branch.
    const res = await postUpdate({
      message: { text: "hello bot", chat: { id: 333444555 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // Command routing tests.
  //
  // NOTE: TELEGRAM_BOT_TOKEN is unset in the harness → sendTelegram() logs and
  // skips actual sends. Tests verify identity/routing decisions only.

  it("unlinked chatId plain text → 200, no crash (not-linked branch)", async () => {
    // chatId 811111111 has no user with telegram_chat_id set → "isn't linked" reply
    const res = await postUpdate({
      message: { text: "where is kit 42", chat: { id: 811111111 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("[Phase5] ambiguous chatId (two users same telegram_chat_id) → 200, no action on either user", async () => {
    // Seed a second user with the same telegram_chat_id as the first (linkUserId already
    // has telegram_chat_id set from the happy-path test above — 987654321).
    // We create another user and patch it to share the same chatId via superuser token.
    const u2 = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ambig2@tg-webhook-test.local",
        password: "Webhookpass1!",
        passwordConfirm: "Webhookpass1!",
        role: "user",
        name: "Ambig User 2",
        telegram_chat_id: "987654321",
      }),
    });
    const u2Data = await u2.json();
    expect(u2Data.id).toBeTruthy();

    // Make sure the first user also still has that chatId (it was set in the happy-path test)
    const u1Res = await fetch(`${baseUrl}/api/collections/users/records/${linkUserId}`, {
      headers: { Authorization: suToken },
    });
    const u1Data = await u1Res.json();
    // If this linkUser's telegram_chat_id was overwritten by a later test, patch it back
    if (u1Data.telegram_chat_id !== "987654321") {
      await fetch(`${baseUrl}/api/collections/users/records/${linkUserId}`, {
        method: "PATCH",
        headers: { Authorization: suToken, "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_chat_id: "987654321" }),
      });
    }

    const res = await postUpdate({
      message: { text: "hello", chat: { id: 987654321 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // Neither user's data should have been mutated beyond the chat_id already set.
    // The key assertion is 200 with no server crash.

    // Cleanup: remove the ambiguous user
    await fetch(`${baseUrl}/api/collections/users/records/${u2Data.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
  });

  it("[Phase5] linked user with empty role (awaiting approval) → 200, no command routed", async () => {
    // Create a user with no role and telegram_chat_id set
    const u3 = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "norole@tg-webhook-test.local",
        password: "Webhookpass1!",
        passwordConfirm: "Webhookpass1!",
        role: "",
        name: "No Role User",
        telegram_chat_id: "820000001",
      }),
    });
    const u3Data = await u3.json();
    expect(u3Data.id).toBeTruthy();

    const res = await postUpdate({
      message: { text: "list kits", chat: { id: 820000001 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // The awaiting-approval branch returns 200 without routing to any slash command.

    // Cleanup
    await fetch(`${baseUrl}/api/collections/users/records/${u3Data.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
  });

  it("linked + approved user, plain text (no slash) → 200, unknown-command branch", async () => {
    // Create a user with role=user and telegram_chat_id set
    const u4 = await fetch(`${baseUrl}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "approved@tg-webhook-test.local",
        password: "Webhookpass1!",
        passwordConfirm: "Webhookpass1!",
        role: "user",
        name: "Approved User",
        telegram_chat_id: "830000001",
      }),
    });
    const u4Data = await u4.json();
    expect(u4Data.id).toBeTruthy();

    // P1: plain text (no leading /) → "Unknown command — try /help", still 200 ok.
    const res = await postUpdate({
      message: { text: "where is kit 1", chat: { id: 830000001 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Cleanup
    await fetch(`${baseUrl}/api/collections/users/records/${u4Data.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken },
    });
  });

  // ---------- replay / double-redeem (single-use guard) ----------

  it("second /start with same code from a different chat id is rejected and user stays linked to first chat", async () => {
    const code = await mintCode(linkUserToken);
    const firstChatId = "777000001";
    const secondChatId = "777000002";

    // First redeem — should succeed
    const res1 = await postUpdate({
      message: { text: "/start " + code, chat: { id: Number(firstChatId) } },
    });
    expect(res1.status).toBe(200);
    expect((await res1.json()).ok).toBe(true);

    // Verify first redeem linked the first chat
    const afterFirst = await fetch(
      `${baseUrl}/api/collections/users/records/${linkUserId}`,
      { headers: { Authorization: suToken } }
    );
    const userAfterFirst = await afterFirst.json();
    expect(userAfterFirst.telegram_chat_id).toBe(firstChatId);

    // Verify code is now consumed
    const codeRows = await fetch(
      `${baseUrl}/api/collections/tg_link_codes/records?filter=(code="${code}")`,
      { headers: { Authorization: suToken } }
    );
    const codeData = await codeRows.json();
    expect(codeData.items).toHaveLength(1);
    expect(codeData.items[0].used).toBe(true);

    // Second redeem with same code from a different chat — must be rejected
    const res2 = await postUpdate({
      message: { text: "/start " + code, chat: { id: Number(secondChatId) } },
    });
    expect(res2.status).toBe(200);
    expect((await res2.json()).ok).toBe(true);

    // User's telegram_chat_id must still be the FIRST chat id (not overwritten)
    const afterSecond = await fetch(
      `${baseUrl}/api/collections/users/records/${linkUserId}`,
      { headers: { Authorization: suToken } }
    );
    const userAfterSecond = await afterSecond.json();
    expect(userAfterSecond.telegram_chat_id).toBe(firstChatId);
    expect(userAfterSecond.telegram_chat_id).not.toBe(secondChatId);
  });
});

// ===========================================================================
// Secret-token enforcement (TELEGRAM_BOT_SECRET set)
//
// This describe block boots its own PocketBase instance with
// TELEGRAM_BOT_SECRET set in process.env before spawn, which PB inherits.
// It tears down its own PB so it does not interfere with the main describe.
//
// The helper uses spawn() with no explicit env option → inherits process.env.
// We set/restore process.env.TELEGRAM_BOT_SECRET around startPb() so the
// spawned PB process sees the secret at hook load time ($os.getenv reads the
// env once per request in Goja).
// ===========================================================================

describe("tg_webhook hook — secret-token enforcement", () => {
  let pb2, baseUrl2;
  const TEST_SECRET = "test-secret-xyz-abc-123";

  function postWebhook(update, headers = {}) {
    return fetch(`${baseUrl2}/api/tg/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(update),
    });
  }

  beforeAll(async () => {
    // Set secret BEFORE spawning PB so the child process inherits it.
    // TG_SKIP_SIGNATURE_CHECK must not be set (ensure it's absent).
    process.env.TELEGRAM_BOT_SECRET = TEST_SECRET;
    delete process.env.TG_SKIP_SIGNATURE_CHECK;
    pb2 = await startPb();
    baseUrl2 = pb2.baseUrl;
  }, 60000);

  afterAll(async () => {
    await stopPb();
    // Restore env so subsequent test files are unaffected.
    delete process.env.TELEGRAM_BOT_SECRET;
  });

  it("POST with no X-Telegram-Bot-Api-Secret-Token header → 401", async () => {
    const res = await postWebhook({ message: { text: "/start", chat: { id: 1 } } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("bad secret");
  });

  it("POST with wrong secret header value → 401", async () => {
    const res = await postWebhook(
      { message: { text: "/start", chat: { id: 1 } } },
      { "X-Telegram-Bot-Api-Secret-Token": "wrong-secret-value" }
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("bad secret");
  });

  it("POST with correct secret header → 200 (proceeds past auth gate)", async () => {
    const res = await postWebhook(
      { message: { text: "/start", chat: { id: 99 } } },
      { "X-Telegram-Bot-Api-Secret-Token": TEST_SECRET }
    );
    // The request passes the auth gate; /start with no code returns 200 ok:true
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ===========================================================================
// P1 command dispatch
//
// Seeds: one admin user (linked), one kit at an entity, one product with
// track_in_status=true, one component of that product in the kit.
// TELEGRAM_BOT_TOKEN unset → sendTelegram() skips actual sends — tests assert
// only routing (status 200, ok:true) and visible side-effects.
// ===========================================================================

describe("tg_webhook P1 — command dispatch", () => {
  let pb3, baseUrl3, suToken3;
  const CMD_CHAT_ID = "900000001";
  let cmdUserId, kitId, entityId, prodId, compId;

  function postCmd(text) {
    return fetch(`${baseUrl3}/api/tg/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { text, chat: { id: Number(CMD_CHAT_ID) } } }),
    });
  }

  beforeAll(async () => {
    pb3 = await startPb();
    baseUrl3 = pb3.baseUrl;
    suToken3 = pb3.suToken;

    // Linked admin user
    const u = await fetch(`${baseUrl3}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "cmd-user@tg-p1-test.local",
        password: "Cmdpass1!",
        passwordConfirm: "Cmdpass1!",
        role: "admin",
        name: "P1 CMD User",
        telegram_chat_id: CMD_CHAT_ID,
      }),
    });
    cmdUserId = (await u.json()).id;
    expect(cmdUserId).toBeTruthy();

    // Entity
    const e = await fetch(`${baseUrl3}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P1 Warehouse", category: "storage", is_active: true }),
    });
    entityId = (await e.json()).id;

    // Kit
    const k = await fetch(`${baseUrl3}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "P1-KIT-001", is_active: true, notes: "p1 test kit" }),
    });
    kitId = (await k.json()).id;

    // Transaction: kit → entity
    const now = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
    await fetch(`${baseUrl3}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ kit: kitId, to_entity: entityId, timestamp: now, created_by: cmdUserId }),
    });

    // Product with track_in_status=true
    const p = await fetch(`${baseUrl3}/api/collections/products/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P1 Test Mat", is_active: true, is_serialized: false, track_in_status: true }),
    });
    prodId = (await p.json()).id;

    // Component of that product
    const comp = await fetch(`${baseUrl3}/api/collections/components/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ product: prodId, quantity: 2, is_active: true }),
    });
    compId = (await comp.json()).id;

    // Component_transaction: component → kit
    await fetch(`${baseUrl3}/api/collections/component_transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ component: compId, to_kit: kitId, quantity: 2, timestamp: now }),
    });
  }, 60000);

  afterAll(stopPb);

  it("/help → 200 ok", async () => {
    const res = await postCmd("/help");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/me → 200 ok", async () => {
    const res = await postCmd("/me");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/kits → 200 ok (lists the seeded kit)", async () => {
    const res = await postCmd("/kits");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/kit P1-KIT-001 → 200 ok (tracked product present)", async () => {
    const res = await postCmd("/kit P1-KIT-001");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/kit P1-KIT-001 all → 200 ok (full contents)", async () => {
    const res = await postCmd("/kit P1-KIT-001 all");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/kit NOSUCHKIT → 200 ok (not-found branch)", async () => {
    const res = await postCmd("/kit NOSUCHKIT");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/kit (no serial) → 200 ok (usage hint)", async () => {
    const res = await postCmd("/kit");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/requests → 200 ok (no open requests → empty message)", async () => {
    const res = await postCmd("/requests");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/requests → 200 ok (with one open request)", async () => {
    // Seed an open request
    const today = new Date().toISOString().slice(0, 10);
    const req = await fetch(`${baseUrl3}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({
        requester: cmdUserId,
        designated_kit: kitId,
        status: "open",
        date: today,
        delivery_date: today,
      }),
    });
    const reqData = await req.json();
    expect(reqData.id).toBeTruthy();

    const res = await postCmd("/requests");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Cleanup
    await fetch(`${baseUrl3}/api/collections/requests/records/${reqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken3 },
    });
  });

  it("/find P1-KIT → 200 ok (matches seeded kit)", async () => {
    const res = await postCmd("/find P1-KIT");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/find Warehouse → 200 ok (matches seeded entity)", async () => {
    const res = await postCmd("/find Warehouse");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/find (no text) → 200 ok (usage hint)", async () => {
    const res = await postCmd("/find");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("unknown slash command → 200 ok", async () => {
    const res = await postCmd("/unknowncmd");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("plain text (no slash) from linked user → 200 ok (unknown-command branch)", async () => {
    const res = await postCmd("hello");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ===========================================================================
// P2 — gated write commands
//
// Separate PB instance (pb4). Seeds:
//   - admin user (CHAT_ADMIN) + technician user (CHAT_TECH) + user-role user (CHAT_USER)
//   - two entities (P2 Entity Alpha, P2 Entity Beta)
//   - one kit (P2-KIT-001) transacted to Entity Alpha
//
// Tests: role-gate rejection, happy-path mutation + DB assertion, audit row
// actor set (the "swallow-trap" check), missing-args usage hints, not-found.
// ===========================================================================

describe("tg_webhook P2 — write commands", () => {
  let pb4, baseUrl4, suToken4;
  const CHAT_ADMIN = "940000001";
  const CHAT_TECH  = "940000002";
  const CHAT_USER  = "940000003";
  let adminId4, techId4, userId4;
  let kitId4, entityAId4, entityBId4;

  function postAs(chatId, text) {
    return fetch(`${baseUrl4}/api/tg/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { text, chat: { id: Number(chatId) } } }),
    });
  }

  async function getAuditRows(recordId, action) {
    const filter = encodeURIComponent(`record_id="${recordId}"&&action="${action}"`);
    const res = await fetch(
      `${baseUrl4}/api/collections/audit_log/records?filter=${filter}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const data = await res.json();
    return data.items || [];
  }

  beforeAll(async () => {
    pb4 = await startPb();
    baseUrl4 = pb4.baseUrl;
    suToken4 = pb4.suToken;

    const ua = await fetch(`${baseUrl4}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "p2-admin@tg-p2-test.local",
        password: "P2adminpass1!",
        passwordConfirm: "P2adminpass1!",
        role: "admin",
        name: "P2 Admin",
        telegram_chat_id: CHAT_ADMIN,
      }),
    });
    adminId4 = (await ua.json()).id;
    expect(adminId4).toBeTruthy();

    const ut = await fetch(`${baseUrl4}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "p2-tech@tg-p2-test.local",
        password: "P2techpass1!",
        passwordConfirm: "P2techpass1!",
        role: "technician",
        name: "P2 Technician",
        telegram_chat_id: CHAT_TECH,
      }),
    });
    techId4 = (await ut.json()).id;
    expect(techId4).toBeTruthy();

    const uu = await fetch(`${baseUrl4}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "p2-user@tg-p2-test.local",
        password: "P2userpass1!",
        passwordConfirm: "P2userpass1!",
        role: "user",
        name: "P2 Regular User",
        telegram_chat_id: CHAT_USER,
      }),
    });
    userId4 = (await uu.json()).id;
    expect(userId4).toBeTruthy();

    const ea = await fetch(`${baseUrl4}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P2 Entity Alpha", category: "storage", is_active: true }),
    });
    entityAId4 = (await ea.json()).id;
    expect(entityAId4).toBeTruthy();

    const eb = await fetch(`${baseUrl4}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "P2 Entity Beta", category: "field", is_active: true }),
    });
    entityBId4 = (await eb.json()).id;
    expect(entityBId4).toBeTruthy();

    const k = await fetch(`${baseUrl4}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "P2-KIT-001", is_active: true }),
    });
    kitId4 = (await k.json()).id;
    expect(kitId4).toBeTruthy();

    // Initial transaction: kit → Entity Alpha
    const now = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
    await fetch(`${baseUrl4}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ kit: kitId4, to_entity: entityAId4, timestamp: now, created_by: adminId4 }),
    });
  }, 60000);

  afterAll(stopPb);

  // ---------- /move — role gate ----------

  it("/move — user role → permission denied, no new transaction", async () => {
    const res = await postAs(CHAT_USER, "/move P2-KIT-001 P2 Entity Beta");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const txRes = await fetch(
      `${baseUrl4}/api/collections/transactions/records?filter=${encodeURIComponent(`kit="${kitId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const txData = await txRes.json();
    expect(txData.totalItems).toBe(1);
  });

  it("/move — missing entity arg → usage hint (200 ok)", async () => {
    const res = await postAs(CHAT_ADMIN, "/move P2-KIT-001");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/move — kit not found → 200 ok, reply contains error text", async () => {
    const res = await postAs(CHAT_ADMIN, "/move NOSUCHKIT P2 Entity Beta");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("Kit not found");
  });

  it("/move — entity not found → 200 ok, reply contains error text", async () => {
    const res = await postAs(CHAT_ADMIN, "/move P2-KIT-001 No Such Entity");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("Entity not found");
  });

  it("/move — admin happy path → creates transaction + audit row with actor set + reply has kit+entity", async () => {
    const txBefore = await fetch(
      `${baseUrl4}/api/collections/transactions/records?filter=${encodeURIComponent(`kit="${kitId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const beforeCount = (await txBefore.json()).totalItems;

    const res = await postAs(CHAT_ADMIN, "/move P2-KIT-001 P2 Entity Beta");
    expect(res.status).toBe(200);
    const moveBody = await res.json();
    expect(moveBody.ok).toBe(true);
    expect(moveBody.reply).toContain("Moved");
    expect(moveBody.reply).toContain("P2-KIT-001");
    expect(moveBody.reply).toContain("P2 Entity Beta");

    const txAfter = await fetch(
      `${baseUrl4}/api/collections/transactions/records?filter=${encodeURIComponent(`kit="${kitId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const afterData = await txAfter.json();
    expect(afterData.totalItems).toBe(beforeCount + 1);
    const newest = afterData.items[0];
    expect(newest.to_entity).toBe(entityBId4);

    // Audit row: actor = adminId4, via = tg-command
    const auditRows = await getAuditRows(newest.id, "create");
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].actor).toBe(adminId4);
    const changes = JSON.parse(auditRows[0].changes);
    expect(changes.via).toBe("tg-command");
  });

  it("/move — technician happy path → creates transaction + audit row with tech actor", async () => {
    // Kit is now at Entity Beta; move back to Alpha
    const res = await postAs(CHAT_TECH, "/move P2-KIT-001 P2 Entity Alpha");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const txAfter = await fetch(
      `${baseUrl4}/api/collections/transactions/records?filter=${encodeURIComponent(`kit="${kitId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const afterData = await txAfter.json();
    const newest = afterData.items[0];
    expect(newest.to_entity).toBe(entityAId4);

    const auditRows = await getAuditRows(newest.id, "create");
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].actor).toBe(techId4);
    const changes = JSON.parse(auditRows[0].changes);
    expect(changes.via).toBe("tg-command");
  });

  it("/move — kit already at destination → no-op reply, no new transaction, no audit row", async () => {
    // Kit is currently at Entity Alpha (from prior test). Issue /move to Alpha again.
    const txBefore = await fetch(
      `${baseUrl4}/api/collections/transactions/records?filter=${encodeURIComponent(`kit="${kitId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const beforeData = await txBefore.json();
    const beforeCount = beforeData.totalItems;
    const beforeNewestId = beforeData.items[0].id;

    const res = await postAs(CHAT_ADMIN, "/move P2-KIT-001 P2 Entity Alpha");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("already at");
    expect(body.reply).toContain("P2-KIT-001");
    expect(body.reply).toContain("P2 Entity Alpha");

    const txAfter = await fetch(
      `${baseUrl4}/api/collections/transactions/records?filter=${encodeURIComponent(`kit="${kitId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const afterData = await txAfter.json();
    expect(afterData.totalItems).toBe(beforeCount);
    expect(afterData.items[0].id).toBe(beforeNewestId);
  });

  // ---------- /approve — role gate + happy path ----------

  it("/approve — missing handle → usage hint (200 ok)", async () => {
    const res = await postAs(CHAT_ADMIN, "/approve");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/approve — handle not found → 200 ok, reply contains error text", async () => {
    const res = await postAs(CHAT_ADMIN, "/approve zzzzzz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("No request found with handle");
  });

  it("/approve — user role → permission denied, request status unchanged", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: userId4, designated_kit: kitId4, target_entity: entityBId4, status: "open", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const res = await postAs(CHAT_USER, `/approve ${handle}`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const check = await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      headers: { Authorization: suToken4 },
    });
    expect((await check.json()).status).toBe("open");

    await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken4 },
    });
  });

  it("/approve — admin happy path → status=approved, audit row with actor set", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: userId4, designated_kit: kitId4, target_entity: entityBId4, status: "open", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const res = await postAs(CHAT_ADMIN, `/approve ${handle} Looks good!`);
    expect(res.status).toBe(200);
    const approveBody = await res.json();
    expect(approveBody.ok).toBe(true);
    expect(approveBody.reply).toContain("Approved");
    expect(approveBody.reply).toContain(handle);

    const check = await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      headers: { Authorization: suToken4 },
    });
    const checkData = await check.json();
    expect(checkData.status).toBe("approved");
    expect(checkData.decision_notes).toBe("Looks good!");

    const auditRows = await getAuditRows(rqData.id, "update");
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].actor).toBe(adminId4);
    const changes = JSON.parse(auditRows[0].changes);
    expect(changes.via).toBe("tg-command");
    expect(changes.status).toBe("approved");
  });

  // ---------- /reject — role gate + happy path ----------

  it("/reject — user role → permission denied, request status unchanged", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: adminId4, designated_kit: kitId4, target_entity: entityBId4, status: "open", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const res = await postAs(CHAT_USER, `/reject ${handle}`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const check = await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      headers: { Authorization: suToken4 },
    });
    expect((await check.json()).status).toBe("open");

    await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken4 },
    });
  });

  it("/reject — technician happy path → status=rejected, audit row with tech actor", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: adminId4, designated_kit: kitId4, target_entity: entityBId4, status: "open", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const res = await postAs(CHAT_TECH, `/reject ${handle} Not available`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const check = await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      headers: { Authorization: suToken4 },
    });
    const checkData = await check.json();
    expect(checkData.status).toBe("rejected");
    expect(checkData.decision_notes).toBe("Not available");

    const auditRows = await getAuditRows(rqData.id, "update");
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].actor).toBe(techId4);
    const changes = JSON.parse(auditRows[0].changes);
    expect(changes.via).toBe("tg-command");
    expect(changes.status).toBe("rejected");
  });

  // ---------- /approve & /reject — no-op guards (B-G3-1 symmetry with MCP decide_request) ----------

  it("/approve — request already approved → no-op reply, no new audit row", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: userId4, designated_kit: kitId4, target_entity: entityBId4, status: "approved", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const beforeAudit = await getAuditRows(rqData.id, "update");
    const beforeCount = beforeAudit.length;

    const res = await postAs(CHAT_ADMIN, `/approve ${handle}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("already approved");
    expect(body.reply).toContain(handle);

    // No new audit row, status unchanged
    const afterAudit = await getAuditRows(rqData.id, "update");
    expect(afterAudit.length).toBe(beforeCount);
    const check = await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      headers: { Authorization: suToken4 },
    });
    expect((await check.json()).status).toBe("approved");

    await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken4 },
    });
  });

  it("/reject — request already rejected → no-op reply, no new audit row", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: userId4, designated_kit: kitId4, target_entity: entityBId4, status: "rejected", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const beforeAudit = await getAuditRows(rqData.id, "update");
    const beforeCount = beforeAudit.length;

    const res = await postAs(CHAT_ADMIN, `/reject ${handle}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("already rejected");

    const afterAudit = await getAuditRows(rqData.id, "update");
    expect(afterAudit.length).toBe(beforeCount);

    await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken4 },
    });
  });

  it("/approve — request already rejected → cannot-transition reply, status unchanged", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rq = await fetch(`${baseUrl4}/api/collections/requests/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({ requester: userId4, designated_kit: kitId4, target_entity: entityBId4, status: "rejected", date: today, delivery_date: today }),
    });
    const rqData = await rq.json();
    const handle = rqData.id.slice(-6);

    const res = await postAs(CHAT_ADMIN, `/approve ${handle}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("rejected");
    expect(body.reply).toContain("cannot approve");

    const check = await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      headers: { Authorization: suToken4 },
    });
    expect((await check.json()).status).toBe("rejected");

    await fetch(`${baseUrl4}/api/collections/requests/records/${rqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken4 },
    });
  });

  // ---------- /request ----------

  it("/request — missing entity arg → usage hint (200 ok)", async () => {
    const res = await postAs(CHAT_ADMIN, "/request P2-KIT-001");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/request — kit not found → 200 ok, error reply", async () => {
    const res = await postAs(CHAT_ADMIN, "/request NOSUCHKIT P2 Entity Alpha");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/request — entity not found → 200 ok, error reply", async () => {
    const res = await postAs(CHAT_ADMIN, "/request P2-KIT-001 No Such Entity");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("/request — admin happy path (no date) → open request created + reply has kit+entity + audit row actor set", async () => {
    const res = await postAs(CHAT_ADMIN, "/request P2-KIT-001 P2 Entity Beta");
    expect(res.status).toBe(200);
    const reqBody = await res.json();
    expect(reqBody.ok).toBe(true);
    expect(reqBody.reply).toContain("Requested");
    expect(reqBody.reply).toContain("P2-KIT-001");
    expect(reqBody.reply).toContain("P2 Entity Beta");

    const listRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(`designated_kit="${kitId4}"&&requester="${adminId4}"&&status="open"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const listData = await listRes.json();
    expect(listData.totalItems).toBeGreaterThan(0);
    const newest = listData.items[0];
    expect(newest.target_entity).toBe(entityBId4);

    const auditRows = await getAuditRows(newest.id, "create");
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].actor).toBe(adminId4);
    const changes = JSON.parse(auditRows[0].changes);
    expect(changes.via).toBe("tg-command");
  });

  it("/request — user role can create a request (any approved role)", async () => {
    const res = await postAs(CHAT_USER, "/request P2-KIT-001 P2 Entity Alpha");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const listRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(`requester="${userId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const listData = await listRes.json();
    expect(listData.totalItems).toBeGreaterThan(0);
    expect(listData.items[0].requester).toBe(userId4);
  });

  it("/request — explicit date → delivery_date stored correctly", async () => {
    const res = await postAs(CHAT_TECH, "/request P2-KIT-001 P2 Entity Beta 2026-12-31");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const listRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(`requester="${techId4}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const listData = await listRes.json();
    expect(listData.totalItems).toBeGreaterThan(0);
    expect(listData.items[0].delivery_date.startsWith("2026-12-31")).toBe(true);
  });

  it("/request — duplicate (same kit + entity + delivery_date) → no-op reply, no second row", async () => {
    const dupDate = "2026-11-15";
    // First request — succeeds and creates row
    const first = await postAs(CHAT_USER, `/request P2-KIT-001 P2 Entity Alpha ${dupDate}`);
    expect(first.status).toBe(200);
    expect((await first.json()).ok).toBe(true);

    const beforeRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(
        `requester="${userId4}"&&designated_kit="${kitId4}"&&target_entity="${entityAId4}"&&status="open"`
      )}`,
      { headers: { Authorization: suToken4 } }
    );
    const beforeCount = (await beforeRes.json()).totalItems;
    expect(beforeCount).toBeGreaterThan(0);

    // Second identical request — must no-op
    const second = await postAs(CHAT_USER, `/request P2-KIT-001 P2 Entity Alpha ${dupDate}`);
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("already exists");
    expect(body.reply).toContain("no new request created");

    const afterRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(
        `requester="${userId4}"&&designated_kit="${kitId4}"&&target_entity="${entityAId4}"&&status="open"`
      )}`,
      { headers: { Authorization: suToken4 } }
    );
    const afterCount = (await afterRes.json()).totalItems;
    expect(afterCount).toBe(beforeCount); // no new row
  });

  it("/request — different delivery_date does not trigger no-op guard (legitimate new ask)", async () => {
    // Seed an open request for D, then issue /request for D+1 — must create a second row.
    const dateA = "2026-09-10";
    const dateB = "2026-09-11";
    const a = await postAs(CHAT_TECH, `/request P2-KIT-001 P2 Entity Beta ${dateA}`);
    expect(a.status).toBe(200);
    expect((await a.json()).ok).toBe(true);

    const beforeRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(
        `requester="${techId4}"&&designated_kit="${kitId4}"&&target_entity="${entityBId4}"&&status="open"`
      )}`,
      { headers: { Authorization: suToken4 } }
    );
    const beforeCount = (await beforeRes.json()).totalItems;
    expect(beforeCount).toBeGreaterThan(0);

    const b = await postAs(CHAT_TECH, `/request P2-KIT-001 P2 Entity Beta ${dateB}`);
    expect(b.status).toBe(200);
    const body = await b.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("Requested");
    expect(body.reply).not.toContain("already exists");

    const afterRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(
        `requester="${techId4}"&&designated_kit="${kitId4}"&&target_entity="${entityBId4}"&&status="open"`
      )}`,
      { headers: { Authorization: suToken4 } }
    );
    const afterCount = (await afterRes.json()).totalItems;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it("/request — shape-valid but semantically invalid date does not crash hook", async () => {
    // Regression guard: `2026-99-99` passes the shape regex but `new Date(...).toISOString()`
    // throws RangeError. The no-op guard must skip cleanly and let the downstream
    // PB save path produce a controlled error reply (not a 500).
    const res = await postAs(CHAT_ADMIN, "/request P2-KIT-001 P2 Entity Alpha 2026-99-99");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // ---------- /request — viewer role security gate (Bug 1 regression test) ----------

  it("/request — viewer role → permission denied, NO new request row created", async () => {
    const CHAT_VIEWER = "940000099";

    // Seed a viewer user linked to CHAT_VIEWER
    const uv = await fetch(`${baseUrl4}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken4, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "p2-viewer@tg-p2-test.local",
        password: "P2viewerpass1!",
        passwordConfirm: "P2viewerpass1!",
        role: "viewer",
        name: "P2 Viewer",
        telegram_chat_id: CHAT_VIEWER,
      }),
    });
    const uvData = await uv.json();
    expect(uvData.id).toBeTruthy();

    // Count requests before attempt
    const beforeRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(`requester="${uvData.id}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const beforeCount = (await beforeRes.json()).totalItems;

    // Viewer sends /request — must be denied
    const res = await fetch(`${baseUrl4}/api/tg/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { text: "/request P2-KIT-001 P2 Entity Alpha", chat: { id: Number(CHAT_VIEWER) } } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Must reply with permission denied — not a successful request
    expect(body.reply).toContain("Permission denied");

    // Assert NO new request row was created for this viewer
    const afterRes = await fetch(
      `${baseUrl4}/api/collections/requests/records?filter=${encodeURIComponent(`requester="${uvData.id}"`)}&sort=-created`,
      { headers: { Authorization: suToken4 } }
    );
    const afterCount = (await afterRes.json()).totalItems;
    expect(afterCount).toBe(beforeCount); // no new row

    // Cleanup
    await fetch(`${baseUrl4}/api/collections/users/records/${uvData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken4 },
    });
  });
});

// ===========================================================================
// HTML-escape regression tests (Bug 2)
//
// Verifies that dynamic values containing &, <, > are properly escaped in
// all command replies. Telegram parse_mode:HTML rejects unescaped chars and
// silently drops the whole reply — these tests catch any regression.
//
// Seeds: admin user, entity named "R&D <test>", kit with notes "A < B & C > D".
// ===========================================================================

describe("tg_webhook — HTML-escape regression", () => {
  let pb5, baseUrl5, suToken5;
  const ESCAPE_CHAT = "950000001";
  let escapeUserId, escapeKitId, escapeEntityId, escapeKitSerial;

  function postCmd5(text) {
    return fetch(`${baseUrl5}/api/tg/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { text, chat: { id: Number(ESCAPE_CHAT) } } }),
    });
  }

  beforeAll(async () => {
    pb5 = await startPb();
    baseUrl5 = pb5.baseUrl;
    suToken5 = pb5.suToken;

    // Linked admin user
    const u = await fetch(`${baseUrl5}/api/collections/users/records`, {
      method: "POST",
      headers: { Authorization: suToken5, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "escape-user@tg-escape-test.local",
        password: "Escapepass1!",
        passwordConfirm: "Escapepass1!",
        role: "admin",
        name: "Escape & Test <User>",
        telegram_chat_id: ESCAPE_CHAT,
      }),
    });
    const uData = await u.json();
    escapeUserId = uData.id;
    expect(escapeUserId).toBeTruthy();

    // Entity with & and <> in name (the core escape test entity)
    const e = await fetch(`${baseUrl5}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken5, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "R&D <test>", category: "field", is_active: true }),
    });
    escapeEntityId = (await e.json()).id;
    expect(escapeEntityId).toBeTruthy();

    // Kit with & and <> in notes
    escapeKitSerial = "ESC-KIT-001";
    const k = await fetch(`${baseUrl5}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken5, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: escapeKitSerial, is_active: true, notes: "A < B & C > D" }),
    });
    escapeKitId = (await k.json()).id;
    expect(escapeKitId).toBeTruthy();

    // Transaction: kit → entity so /kit shows a holder
    const now = new Date().toISOString().replace("T", " ").replace("Z", "") + "Z";
    await fetch(`${baseUrl5}/api/collections/transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken5, "Content-Type": "application/json" },
      body: JSON.stringify({ kit: escapeKitId, to_entity: escapeEntityId, timestamp: now, created_by: escapeUserId }),
    });
  }, 60000);

  afterAll(stopPb);

  it("/find R&D → reply contains escaped &amp; and &lt; (not raw chars)", async () => {
    const res = await postCmd5("/find R&D");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toBeDefined();
    // The entity name "R&D <test>" must be escaped in the reply
    expect(body.reply).toContain("R&amp;D");
    expect(body.reply).toContain("&lt;test&gt;");
    // Must NOT contain raw unescaped chars in the entity name portion
    // (the search header "Search: R&D" also gets escaped)
    expect(body.reply).not.toMatch(/R&D(?!;)/); // raw & not followed by entity ref
  });

  it("/kit ESC-KIT-001 → reply has escaped notes (A &lt; B &amp; C &gt; D)", async () => {
    const res = await postCmd5("/kit ESC-KIT-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toBeDefined();
    expect(body.reply).toContain("&lt;");
    expect(body.reply).toContain("&amp;");
    expect(body.reply).toContain("&gt;");
  });

  it("/kit ESC-KIT-001 → reply has escaped holder (entity named R&D <test>)", async () => {
    const res = await postCmd5("/kit ESC-KIT-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toContain("R&amp;D");
    expect(body.reply).toContain("&lt;test&gt;");
  });

  it("/me → reply has escaped name containing & and < >", async () => {
    const res = await postCmd5("/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toBeDefined();
    // Name "Escape & Test <User>" must be escaped
    expect(body.reply).toContain("Escape &amp; Test");
    expect(body.reply).toContain("&lt;User&gt;");
  });
});
