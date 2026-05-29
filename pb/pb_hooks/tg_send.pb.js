/// <reference path="../pb_data/types.d.ts" />
// POST /api/tg/send — Admin-initiated outbound Telegram message to a single chat_id.
//
// Body (JSON):
//   { "chat_id": "-1001234567890", "text": "free-form message (HTML supported)" }
//
// Auth: admin role only.
// Audit: writes to audit_log (non-fatal on failure).
//
// Environment (Fly secrets):
//   TELEGRAM_BOT_TOKEN — from @BotFather
//
// NO module-level vars — PB v0.22 Goja isolation.
// sendTelegram is defined INSIDE the routerAdd callback (Goja per-callback isolation;
// top-level function declarations are NOT visible inside callbacks — see tg_group_digest.pb.js).

routerAdd("POST", "/api/tg/send", function(c) {

  // ===========================================================================
  // Auth gate — admin only
  // ===========================================================================
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  // ===========================================================================
  // Parse + validate body (BEFORE creds check so 400s are reachable without env)
  // ===========================================================================
  // c.bind(non-pointer map) throws in PB v0.22 Goja; use info.data (already parsed).
  var input = info.data || {};

  var chat_id = (input.chat_id !== undefined && input.chat_id !== null)
    ? String(input.chat_id).trim() : "";
  var text = (input.text !== undefined && input.text !== null)
    ? String(input.text).trim() : "";

  if (!chat_id || !text) {
    return c.json(400, { error: "chat_id and text are required" });
  }

  // ===========================================================================
  // Creds check — explicit admin action → 500 (not silent skip)
  // ===========================================================================
  var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
  if (!token) {
    console.log("[tg_send] TELEGRAM_BOT_TOKEN not set");
    return c.json(500, { error: "Telegram credentials not configured" });
  }

  // ===========================================================================
  // sendTelegram helper (MUST be inside callback — Goja isolation)
  // Copied verbatim from tg_group_digest.pb.js (4096-char chunk splitter).
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
    for (var i = 0; i < chunks.length; i++) {
      var res = $http.send({
        url: url,
        method: "POST",
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: "HTML",
          disable_web_page_preview: true
        }),
        headers: { "content-type": "application/json" },
        timeout: 20000
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error("Telegram API error status=" + res.statusCode + " body=" + res.raw);
      }
      console.log("[tg_send] sent chunk " + (i + 1) + "/" + chunks.length + " status=" + res.statusCode);
    }
  }

  // ===========================================================================
  // Send
  // ===========================================================================
  try {
    sendTelegram(token, chat_id, text);
    console.log("[tg_send] sent to chat_id=" + chat_id + " chars=" + text.length);
  } catch (sendErr) {
    console.log("[tg_send] send error: " + sendErr);
    return c.json(502, { error: "telegram send failed: " + String(sendErr) });
  }

  // ===========================================================================
  // Write to audit_log (non-fatal — mirror wa_meta_send.pb.js column shape)
  // ===========================================================================
  try {
    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var auditRec = new Record(auditCol);
    auditRec.set("actor", info.authRecord.id);
    auditRec.set("action", "send_telegram");
    auditRec.set("collection_name", "messages");
    auditRec.set("record_id", chat_id);
    var changesObj = { to: chat_id, chars: text.length, via: "admin-send" };
    auditRec.set("changes", JSON.stringify(changesObj));
    $app.dao().saveRecord(auditRec);
    console.log("[tg_send] audit_log written actor=" + info.authRecord.id + " to=" + chat_id);
  } catch (auditErr) {
    console.log("[tg_send] audit_log write error: " + auditErr);
    // Non-fatal — don't fail the send because of audit failure
  }

  // ===========================================================================
  // Success
  // ===========================================================================
  return c.json(200, { sent: true, chars: text.length });
});
