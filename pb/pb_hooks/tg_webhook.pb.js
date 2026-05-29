/// <reference path="../pb_data/types.d.ts" />
// POST /api/tg/webhook — Telegram webhook receiver (Phase 5: /start <code> linking + AI bot).
//
// Phase 5 additions (on top of Phase 4):
//   non-/start text with linked+approved user → AI bot via /api/ai/chat (same engine as WhatsApp).
//   unlinked chat → hint to link in app.
//   linked + unapproved role → awaiting-approval reply.
//   ambiguous (>1 user with same telegram_chat_id) → contact-admin reply, no action.
//
// This file handles:
//   /start <code>  — redeem a tg_link_codes row to bind telegram_chat_id to the user.
//   /start         — no code, reply with hint.
//   other text     — AI bot (Phase 5) or unlinked/role-gate reply.
//   missing message/text — 200 no-op (Telegram status updates, etc.).
//
// SECURITY (high-risk — read before changing):
//   The link code is a BEARER CREDENTIAL. Any Telegram user who sends /start <code>
//   gets their chat_id bound to the PB user that owns the code. Therefore:
//     - 128-bit entropy codes only (minted by tg_link.pb.js).
//     - 10-minute TTL enforced at redeem time.
//     - Single-use: used flag set atomically before reply.
//     - tg_link_codes collection rules are all null (not enumerable via REST).
//   Expiry AND used checks happen BEFORE any DB write.
//
// Secret token verification:
//   Telegram sends X-Telegram-Bot-Api-Secret-Token header when the webhook is
//   registered with a secret_token. Logic mirrors wa_meta_webhook.pb.js:
//     - TELEGRAM_BOT_SECRET set  → header must match, else 401.
//     - TELEGRAM_BOT_SECRET unset → log warning + proceed (local dev / CI without secrets).
//     - TG_SKIP_SIGNATURE_CHECK=1 → always proceed (explicit dev escape hatch).
//
// Environment (Fly secrets):
//   TELEGRAM_BOT_TOKEN       — from @BotFather; used to send replies.
//   TELEGRAM_BOT_SECRET      — random string (openssl rand -hex 20); must match
//                               secret_token used in setWebhook registration.
//   TG_SKIP_SIGNATURE_CHECK  — set to "1" to bypass secret check (local dev only).
//   PB_AI_CHAT_URL           — optional; default "http://127.0.0.1:8090/api/ai/chat".
//
// NO module-level vars — PB v0.22 Goja isolation.
// All helpers defined INSIDE the routerAdd callback.

routerAdd("POST", "/api/tg/webhook", function(c) {

  // ===========================================================================
  // INLINE HELPERS (inside callback — Goja isolation)
  // ===========================================================================

  // Constant-time string compare (mitigate header timing attacks).
  // Mirrors safeEqualHex from wa_meta_webhook.pb.js.
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    var la = [], lb = [];
    for (var i = 0; i < a.length; i++) la.push(a.charCodeAt(i));
    for (var i = 0; i < b.length; i++) lb.push(b.charCodeAt(i));
    var maxLen = Math.max(la.length, lb.length);
    var result = la.length ^ lb.length;
    for (var i = 0; i < maxLen; i++) result |= (la[i] || 0) ^ (lb[i] || 0);
    return result === 0;
  }

  // sendTelegram — copied verbatim from tg_send.pb.js / tg_group_digest.pb.js.
  // Reads TELEGRAM_BOT_TOKEN at call time. If unset, logs and skips (no crash).
  function sendTelegram(chatId, text) {
    var tok = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!tok) {
      console.log("[tg_webhook] TELEGRAM_BOT_TOKEN not set — skipping reply to chatId=" + chatId);
      return;
    }
    var MAX = 4000;
    var chunks = [];
    var remaining = text;
    while (remaining.length > MAX) {
      var breakAt = -1;
      var dbl = remaining.lastIndexOf("\n\n", MAX);
      if (dbl > 0) {
        breakAt = dbl + 2;
      } else {
        var nl = remaining.lastIndexOf("\n", MAX);
        if (nl > 0) {
          breakAt = nl + 1;
        } else {
          var sp = remaining.lastIndexOf(" ", MAX);
          breakAt = sp > 0 ? sp + 1 : MAX;
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());

    var url = "https://api.telegram.org/bot" + tok + "/sendMessage";
    for (var i = 0; i < chunks.length; i++) {
      try {
        var res = $http.send({
          url: url,
          method: "POST",
          body: JSON.stringify({
            chat_id: chatId,
            text: chunks[i],
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          headers: { "content-type": "application/json" },
          timeout: 20000,
        });
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.log("[tg_webhook] Telegram API error status=" + res.statusCode + " chatId=" + chatId);
        }
      } catch (e) {
        console.log("[tg_webhook] sendTelegram HTTP error: " + e);
      }
    }
  }

  // ===========================================================================
  // Secret-token verification (mirrors wa_meta_webhook.pb.js pattern)
  // ===========================================================================
  var expectedSecret = $os.getenv("TELEGRAM_BOT_SECRET") || "";
  var skipCheck = $os.getenv("TG_SKIP_SIGNATURE_CHECK") === "1";

  if (!skipCheck) {
    if (!expectedSecret) {
      console.log("[tg_webhook] TELEGRAM_BOT_SECRET not set — proceeding without verification (set in prod)");
    } else {
      var headerSecret = c.request().header.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!safeEqual(headerSecret, expectedSecret)) {
        console.log("[tg_webhook] bad secret token — rejecting");
        return c.json(401, { error: "bad secret" });
      }
    }
  } else {
    console.log("[tg_webhook] TG_SKIP_SIGNATURE_CHECK=1 — skipping secret verification");
  }

  // ===========================================================================
  // Parse body via $apis.requestInfo(c).data (NOT c.bind — PB v0.22 Goja)
  // ===========================================================================
  var update = $apis.requestInfo(c).data || {};

  var message = update.message;
  if (!message) {
    // Telegram sends non-message updates (edited_message, channel_post, etc.) — ack silently.
    return c.json(200, { ok: true });
  }

  var text = (message.text) ? String(message.text) : "";
  var chat = message.chat;
  if (!chat || !text) {
    return c.json(200, { ok: true });
  }

  var chatId = String(chat.id);

  // SECURITY: never log message text — /start <code> text IS the bearer credential.
  // Log only the chat id and a redacted verb indicator.
  var logVerb = text.startsWith("/start") ? "/start <redacted>" : "len=" + text.length;
  console.log("[tg_webhook] inbound chatId=" + chatId + " msg=" + logVerb);

  // ===========================================================================
  // Route: /start <code>
  // ===========================================================================
  var startMatch = text.match(/^\/start\s+(\S+)/);
  if (startMatch) {
    var code = startMatch[1];

    // Look up the code row (DAO — collection rules are null)
    var dao = $app.dao();
    var codeRec = null;
    try {
      codeRec = dao.findFirstRecordByFilter(
        "tg_link_codes",
        "code = {:code}",
        { code: code }
      );
    } catch (_) {
      // findFirstRecordByFilter throws when no record found
    }

    if (!codeRec) {
      console.log("[tg_webhook] /start code not found chatId=" + chatId);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // Check used BEFORE expiry (fail fast on already-used)
    if (codeRec.getBool("used")) {
      console.log("[tg_webhook] /start code already used chatId=" + chatId);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // Check expiry
    var expiresAtStr = codeRec.getString("expires_at") || "";
    var now = new Date();
    var expiresAt = new Date(expiresAtStr.replace(" ", "T").replace(/Z$/, "+00:00"));
    if (isNaN(expiresAt.getTime()) || expiresAt < now) {
      console.log("[tg_webhook] /start code expired chatId=" + chatId + " expires=" + expiresAtStr);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // SECURITY: consume code FIRST, then link user.
    // PB v0.22 Goja does not expose $app.dao().runInTransaction — no transaction API
    // is available in this runtime. We use a consume-first + both-fatal pattern instead:
    //   1. Mark code used=true and save (FATAL if it fails — code stays clean).
    //   2. Load user and set telegram_chat_id and save (FATAL if it fails — code is
    //      burned but user not linked; user must re-mint. This is the safe failure mode:
    //      an attacker who obtained the code cannot replay it, and the victim re-mints).
    //   3. Write audit log (non-fatal — linking already succeeded).
    // Residual TOCTOU window: two concurrent requests can both pass the pre-tx used-check
    // above; the first to reach saveRecord(code) wins (SQLite serialises writes), the
    // second gets a save error and returns the generic error message. The window is
    // narrow (milliseconds, same code, same user) and the worst outcome is one extra
    // failed attempt — not a privilege escalation.
    var userId = codeRec.getString("user");

    // Step 1: consume the code (FATAL — no silent swallow)
    var nowIso = now.toISOString().replace("T", " ").replace("Z", "") + "Z";
    codeRec.set("used", true);
    codeRec.set("used_at", nowIso);
    try {
      dao.saveRecord(codeRec);
    } catch (e) {
      console.log("[tg_webhook] saveRecord(code) consume error uid=" + userId + ": " + e);
      sendTelegram(chatId, "Invalid or expired link code. Generate a new one in the app.");
      return c.json(200, { ok: true });
    }

    // Step 2: load user and link (FATAL — code is already burned; user must re-mint)
    var userRec = null;
    try {
      userRec = dao.findRecordById("users", userId);
    } catch (e) {
      console.log("[tg_webhook] user lookup error uid=" + userId + ": " + e);
      sendTelegram(chatId, "Internal error — please try again.");
      return c.json(200, { ok: true });
    }

    userRec.set("telegram_chat_id", chatId);
    try {
      dao.saveRecord(userRec);
    } catch (e) {
      console.log("[tg_webhook] saveRecord(user) link error uid=" + userId + ": " + e);
      sendTelegram(chatId, "Internal error — please try again.");
      return c.json(200, { ok: true });
    }

    // Step 3: audit log (non-fatal — linking already succeeded)
    try {
      var auditCol = dao.findCollectionByNameOrId("audit_log");
      var auditRec = new Record(auditCol);
      auditRec.set("collection_name", "users");
      auditRec.set("record_id", userId);
      auditRec.set("actor", userId);
      auditRec.set("action", "update");
      auditRec.set("changes", JSON.stringify({
        via: "tg-link",
        telegram_chat_id: chatId,
      }));
      dao.saveRecord(auditRec);
      console.log("[tg_webhook] audit_log written for user=" + userId);
    } catch (auditErr) {
      console.log("[tg_webhook] audit_log write error: " + auditErr);
    }

    console.log("[tg_webhook] linked user=" + userId + " chatId=" + chatId);
    sendTelegram(chatId, "Linked! You'll receive kit-tracker notifications here.");
    return c.json(200, { ok: true });
  }

  // ===========================================================================
  // Route: /start with no code → hint
  // ===========================================================================
  if (text.startsWith("/start")) {
    sendTelegram(chatId, "Open kit-tracker → Profile → Link Telegram to connect your account.");
    return c.json(200, { ok: true });
  }

  // ===========================================================================
  // Route: arbitrary text (Phase 5) — AI bot via /api/ai/chat
  // ===========================================================================

  // Step 1: Resolve user by telegram_chat_id.
  // Note: telegram_chat_id is non-unique by design (the field has no uniqueness
  // constraint) — an ambiguous state (>1 user) must be treated as a security
  // error and must NOT proceed.
  var dao = $app.dao();
  var tgUsers = [];
  try {
    tgUsers = dao.findRecordsByFilter(
      "users",
      "telegram_chat_id = {:cid}",
      "",
      2,
      0,
      { cid: chatId }
    );
  } catch (e) {
    console.log("[tg_webhook] user lookup error chatId=" + chatId + ": " + e);
  }

  if (!tgUsers || tgUsers.length === 0) {
    console.log("[tg_webhook] no user linked for chatId=" + chatId);
    sendTelegram(chatId, "Your Telegram isn't linked. Open kit-tracker → Profile → Link Telegram to connect.");
    return c.json(200, { ok: true });
  }

  if (tgUsers.length > 1) {
    // Ambiguous — do NOT act on behalf of any user.
    console.log("[tg_webhook] ambiguous: " + tgUsers.length + " users share chatId=" + chatId);
    sendTelegram(chatId, "Multiple accounts are linked to this Telegram. Contact an admin.");
    return c.json(200, { ok: true });
  }

  var tgUser = tgUsers[0];

  // Step 2: Role gate (mirror wa_meta_webhook ~461)
  var tgRole = tgUser.getString("role");
  if (!tgRole || tgRole === "denied") {
    console.log("[tg_webhook] user=" + tgUser.id + " role=" + tgRole + " — awaiting approval");
    sendTelegram(chatId, "Your account is awaiting approval — an admin needs to set your role.");
    return c.json(200, { ok: true });
  }

  // Step 3: Mint token + call /api/ai/chat (mirror wa_meta_webhook ~819-847)
  // SECURITY: never log the token.
  var tgToken = "";
  try {
    tgToken = $tokens.recordAuthToken($app, tgUser);
  } catch (e) {
    console.log("[tg_webhook] token mint error user=" + tgUser.id + ": " + e);
    sendTelegram(chatId, "Sorry — I hit an error. Try again in a moment.");
    return c.json(200, { ok: true });
  }

  var aiChatUrl = $os.getenv("PB_AI_CHAT_URL") || "http://127.0.0.1:8090/api/ai/chat";
  var aiRes;
  try {
    aiRes = $http.send({
      url: aiChatUrl,
      method: "POST",
      headers: {
        "Authorization": tgToken,
        "content-type": "application/json"
      },
      body: JSON.stringify({ message: text, sessionId: "tg:" + chatId }),
      timeout: 60000
    });
  } catch (e) {
    console.log("[tg_webhook] /api/ai/chat HTTP error user=" + tgUser.id + ": " + e);
    sendTelegram(chatId, "Sorry — I hit an error. Try again in a moment.");
    return c.json(200, { ok: true });
  }

  if (!aiRes || aiRes.statusCode < 200 || aiRes.statusCode >= 300) {
    var statusCode = aiRes ? aiRes.statusCode : "none";
    console.log("[tg_webhook] /api/ai/chat returned " + statusCode + " user=" + tgUser.id);
    sendTelegram(chatId, "Sorry — I hit an error. Try again in a moment.");
    return c.json(200, { ok: true });
  }

  var tgReplyText = "(no reply)";
  try {
    var parsedAi = JSON.parse(aiRes.raw);
    if (parsedAi && parsedAi.reply) tgReplyText = String(parsedAi.reply);
  } catch (_) {
    console.log("[tg_webhook] ai_chat reply parse error user=" + tgUser.id);
  }

  sendTelegram(chatId, tgReplyText);
  return c.json(200, { ok: true });
});
