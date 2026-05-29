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

  // ---------- arbitrary message → hint ----------

  it("arbitrary message (not /start) returns 200 no crash", async () => {
    const res = await postUpdate({
      message: { text: "hello bot", chat: { id: 333444555 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
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
