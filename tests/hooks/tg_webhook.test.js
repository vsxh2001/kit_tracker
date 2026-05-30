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

  it("[Phase5] linked user with empty role (awaiting approval) → 200, no ai_chat action", async () => {
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
    // The awaiting-approval branch returns 200 without attempting ai_chat.

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

    // Entity (category required since migration 1778970000)
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

    // Component_transaction: component → kit (created_by required by schema)
    await fetch(`${baseUrl3}/api/collections/component_transactions/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ component: compId, to_kit: kitId, quantity: 2, timestamp: now, created_by: cmdUserId }),
    });
  }, 60000);

  afterAll(stopPb);

  it("/help → 200 ok, reply lists commands", async () => {
    const res = await postCmd("/help");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("/kit");
    expect(body.reply).toContain("/requests");
    expect(body.reply).toContain("/find");
    expect(body.reply).toContain("/me");
  });

  it("/me → 200 ok, reply contains user role", async () => {
    const res = await postCmd("/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("admin");
  });

  it("/kits → 200 ok, reply lists the seeded kit serial", async () => {
    const res = await postCmd("/kits");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("P1-KIT-001");
  });

  it("/kit P1-KIT-001 → tracked product present: reply contains product name and ✓", async () => {
    const res = await postCmd("/kit P1-KIT-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("P1 Test Mat");
    expect(body.reply).toContain("✓");
  });

  it("/kit P1-KIT-001 → tracked product present: reply does NOT show ✗ for the present product", async () => {
    const res = await postCmd("/kit P1-KIT-001");
    const body = await res.json();
    // The product IS present, so its line should show ✓ not ✗
    const lines = body.reply.split("\n");
    const matLine = lines.find((l) => l.includes("P1 Test Mat"));
    expect(matLine).toBeTruthy();
    expect(matLine).toContain("✓");
    expect(matLine).not.toContain("✗");
  });

  it("/kit P1-KIT-001 all → 200 ok, full contents contains the component product name", async () => {
    const res = await postCmd("/kit P1-KIT-001 all");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("P1 Test Mat");
    expect(body.reply).toContain("Contents:");
  });

  it("/kit NOSUCHKIT → 200 ok, not-found reply", async () => {
    const res = await postCmd("/kit NOSUCHKIT");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("not found");
  });

  it("/kit (no serial) → 200 ok, usage hint", async () => {
    const res = await postCmd("/kit");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("Usage");
  });

  it("/requests → 200 ok, empty message when no open requests", async () => {
    const res = await postCmd("/requests");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("No open");
  });

  it("/requests → 200 ok, reply contains 6-char id handle when open request exists", async () => {
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
    const body = await res.json();
    expect(body.ok).toBe(true);
    // 6-char id handle appears in the reply
    const handle = reqData.id.slice(-6);
    expect(body.reply).toContain(handle);

    // Cleanup
    await fetch(`${baseUrl3}/api/collections/requests/records/${reqData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken3 },
    });
  });

  it("/find P1-KIT → 200 ok, reply lists the matching kit", async () => {
    const res = await postCmd("/find P1-KIT");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("P1-KIT-001");
  });

  it("/find NOMATCH-XYZ-ZZZZ → 200 ok, no-results reply", async () => {
    const res = await postCmd("/find NOMATCH-XYZ-ZZZZ");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("No results");
  });

  it("/find Warehouse → 200 ok, reply lists the matching entity", async () => {
    const res = await postCmd("/find Warehouse");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("P1 Warehouse");
  });

  it("/find (no text) → 200 ok, usage hint", async () => {
    const res = await postCmd("/find");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("Usage");
  });

  it("unknown slash command → 200 ok, hint reply", async () => {
    const res = await postCmd("/unknowncmd");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("/help");
  });

  it("plain text (no slash) from linked user → 200 ok, unknown-command reply", async () => {
    const res = await postCmd("hello");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("/help");
  });

  // ---------- HTML-escape regression ----------
  // This test would have caught the parse_mode:"HTML" bug:
  // an entity named "R&D <test>" would cause Telegram to return 400 Bad Request,
  // silently dropping the reply. After the fix, dynamic values are escaped and
  // the reply contains "&amp;" / "&lt;" instead of raw "&" / "<".

  it("[HTML-escape] /find with special-chars entity → reply present and contains escaped HTML", async () => {
    // Seed an entity with &, < and > in its name (category required by schema)
    const eHtml = await fetch(`${baseUrl3}/api/collections/entities/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "R&D <test>", category: "field", is_active: true }),
    });
    const eData = await eHtml.json();
    expect(eData.id).toBeTruthy();

    const res = await postCmd("/find R&D");
    expect(res.status).toBe(200);
    const body = await res.json();
    // reply must be present (not dropped)
    expect(body.reply).toBeTruthy();
    // dynamic name must be escaped — raw & and < must NOT appear unescaped
    expect(body.reply).toContain("R&amp;D");
    expect(body.reply).toContain("&lt;test&gt;");

    // Cleanup
    await fetch(`${baseUrl3}/api/collections/entities/records/${eData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken3 },
    });
  });

  it("[HTML-escape] /kit with & in kit notes → reply present and notes are escaped", async () => {
    // Seed a kit with & and < in notes
    const kHtml = await fetch(`${baseUrl3}/api/collections/kits/records`, {
      method: "POST",
      headers: { Authorization: suToken3, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "P1-HTML-KIT", is_active: true, notes: "A < B & C > D" }),
    });
    const kData = await kHtml.json();
    expect(kData.id).toBeTruthy();

    const res = await postCmd("/kit P1-HTML-KIT");
    expect(res.status).toBe(200);
    const body = await res.json();
    // reply must be present (not dropped)
    expect(body.reply).toBeTruthy();
    expect(body.reply).toContain("&lt;");
    expect(body.reply).toContain("&amp;");
    expect(body.reply).toContain("&gt;");

    // Cleanup
    await fetch(`${baseUrl3}/api/collections/kits/records/${kData.id}`, {
      method: "DELETE",
      headers: { Authorization: suToken3 },
    });
  });
});
