/// <reference path="../pb_data/types.d.ts" />
// POST /api/tg/broadcast — Admin-initiated Telegram broadcast to N recipients.
//
// Body (JSON):
//   {
//     "recipientFilter": {
//       "type": "role" | "chat_ids",
//       "value": "admin" | "technician" | "user" | "viewer" | ["123456", ...]
//     },
//     "text": "free-form message (HTML supported)"
//   }
//
// Auth: admin role only.
// Audit: ONE summary audit_log row per broadcast (not per recipient).
//
// Environment (Fly secrets):
//   TELEGRAM_BOT_TOKEN — from @BotFather
//
// NO module-level vars — PB v0.22 Goja isolation.
// sendTelegram defined INSIDE the routerAdd callback (Goja per-callback isolation).

routerAdd("POST", "/api/tg/broadcast", function(c) {

  // ===========================================================================
  // Auth gate — admin only
  // ===========================================================================
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  // ===========================================================================
  // Parse request body (use info.data — c.bind() throws in PB v0.22 Goja)
  // ===========================================================================
  var input = info.data || {};

  var recipientFilter = input.recipientFilter || null;
  var text = (input.text !== undefined && input.text !== null)
    ? String(input.text).trim() : "";

  // Validate recipientFilter
  if (!recipientFilter || !recipientFilter.type) {
    return c.json(400, { error: "recipientFilter.type is required" });
  }

  var filterType = recipientFilter.type;
  if (filterType !== "role" && filterType !== "chat_ids") {
    return c.json(400, { error: "recipientFilter.type must be 'role' or 'chat_ids'" });
  }

  // Validate text
  if (!text) {
    return c.json(400, { error: "text is required and must be non-empty" });
  }

  // ===========================================================================
  // Resolve recipient chat IDs
  // ===========================================================================
  var chatIds = [];

  if (filterType === "role") {
    var role = (recipientFilter.value || "").toString().trim();
    if (!role) {
      return c.json(400, { error: "recipientFilter.value (role name) is required for type=role" });
    }

    var validRoles = { admin: true, technician: true, user: true, viewer: true };
    if (!validRoles[role]) {
      return c.json(400, { error: "invalid role; must be one of: admin, technician, user, viewer" });
    }

    var userRecords = [];
    try {
      userRecords = $app.dao().findRecordsByFilter(
        "users",
        "role = {:r} && telegram_chat_id != ''",
        "-created",
        500,
        0,
        { r: role }
      );
    } catch (e) {
      console.log("[tg_broadcast] users query error: " + e);
      return c.json(500, { error: "failed to query users: " + String(e) });
    }

    for (var i = 0; i < userRecords.length; i++) {
      var chatId = (userRecords[i].getString("telegram_chat_id") || "").trim();
      if (chatId) {
        chatIds.push(chatId);
      }
    }

  } else {
    // type=chat_ids — use provided list directly
    var rawIds = recipientFilter.value;
    if (!rawIds || !Array.isArray(rawIds)) {
      return c.json(400, { error: "recipientFilter.value must be an array of chat_id strings for type=chat_ids" });
    }
    for (var j = 0; j < rawIds.length; j++) {
      var cid = (rawIds[j] || "").toString().trim();
      if (cid) {
        chatIds.push(cid);
      }
    }
  }

  var total = chatIds.length;

  if (total === 0) {
    return c.json(200, { total: 0, sent: 0, failed: 0 });
  }

  // ===========================================================================
  // Creds check — explicit admin action → 500 (not silent skip)
  // ===========================================================================
  var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
  if (!token) {
    console.log("[tg_broadcast] TELEGRAM_BOT_TOKEN not set");
    return c.json(500, { error: "Telegram credentials not configured" });
  }

  // ===========================================================================
  // sendTelegram helper (MUST be inside callback — Goja isolation)
  // Copied verbatim from tg_send.pb.js (4096-char chunk splitter).
  // Returns "sent" or "failed:<error>".
  // ===========================================================================
  function sendTelegram(tok, chatId, txt) {
    var MAX = 4000; // stay comfortably under the 4096 Telegram limit
    var chunks = [];
    var remaining = txt;
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
    for (var ci = 0; ci < chunks.length; ci++) {
      var res = $http.send({
        url: url,
        method: "POST",
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[ci],
          parse_mode: "HTML",
          disable_web_page_preview: true
        }),
        headers: { "content-type": "application/json" },
        timeout: 20000
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error("Telegram API error status=" + res.statusCode + " body=" + res.raw);
      }
    }
    return "sent";
  }

  // ===========================================================================
  // Send to each recipient (serialized — rate-limit safety)
  // ===========================================================================
  var sentCount = 0;
  var failedCount = 0;

  for (var k = 0; k < chatIds.length; k++) {
    var toChatId = chatIds[k];
    var outcome = "sent";

    try {
      sendTelegram(token, toChatId, text);
      sentCount++;
      console.log("[tg_broadcast] sent to chat_id=" + toChatId);
    } catch (sendErr) {
      outcome = "failed";
      failedCount++;
      console.log("[tg_broadcast] send error chat_id=" + toChatId + ": " + sendErr);
    }

    // Per-send outcome logged to console; summary audit below covers aggregate.
    _ = outcome; // suppress unused variable lint
  }

  // ===========================================================================
  // Single summary audit_log row (non-fatal)
  // ===========================================================================
  try {
    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var auditRec = new Record(auditCol);
    auditRec.set("actor", info.authRecord.id);
    auditRec.set("action", "send_telegram");
    auditRec.set("collection_name", "messages");
    auditRec.set("record_id", "broadcast");
    var changesObj = {
      event: "broadcast",
      recipient_type: filterType,
      recipient_value_or_count: filterType === "role" ? recipientFilter.value : total,
      sent: sentCount,
      failed: failedCount,
      total: total,
      by: info.authRecord.id
    };
    auditRec.set("changes", JSON.stringify(changesObj));
    $app.dao().saveRecord(auditRec);
    console.log("[tg_broadcast] audit_log written actor=" + info.authRecord.id + " total=" + total + " sent=" + sentCount);
  } catch (auditErr) {
    console.log("[tg_broadcast] audit_log write error: " + auditErr);
    // Non-fatal
  }

  // ===========================================================================
  // Return summary
  // ===========================================================================
  console.log("[tg_broadcast] done total=" + total + " sent=" + sentCount + " failed=" + failedCount);

  return c.json(200, { total: total, sent: sentCount, failed: failedCount });
});
