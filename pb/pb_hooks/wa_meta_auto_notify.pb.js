/// <reference path="../pb_data/types.d.ts" />
// Phase 2b: Auto-send WhatsApp (Meta Cloud API) on key events.
//
// Hooks:
//   onRecordAfterUpdateRequest("requests") — approved → fulfilled: notify requester.
//   onRecordAfterCreateRequest("transactions") — kit moved: opt-in via WHATSAPP_NOTIFY_MOVES=1.
//
// Environment:
//   WHATSAPP_PHONE_NUMBER_ID  — Meta phone number ID (from Business API)
//   WHATSAPP_TOKEN            — Meta user/system token with WhatsApp permissions
//   WHATSAPP_NOTIFY_MOVES=1   — opt-in for transaction-create notifications (default off)
//
// PB v0.22 Goja isolation: ALL logic inlined per callback. No cross-callback scope.
// Best-effort: failed sends log to audit_log but never block the underlying save.

// ---------------------------------------------------------------------------
// notificationAllowed(user, channel, event) — inline pref gate.
// Empty/missing prefs → full opt-in (preserves existing behavior).
// channel: "whatsapp" | "email" | "telegram"
// event: "request_fulfilled" | "kit_moved" | "maintenance_digest" | "overdue_return"
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Top-level helper declarations kept as canonical source only.
// PB v0.22 Goja isolation: top-level function declarations are NOT reliably
// visible inside onRecord/cron/routerAdd callbacks at runtime. Each callback
// below inlines its own local copies of the helpers it needs.
// ---------------------------------------------------------------------------
function _isInQuietHours(user) {
  var raw = user.getString("notification_prefs") || "";
  if (!raw || !raw.trim()) return false;
  try {
    var prefs = JSON.parse(raw);
    if (!prefs || !prefs.quiet_hours || !prefs.quiet_hours.enabled) return false;
    var tz = prefs.quiet_hours.timezone || "UTC";
    var start = prefs.quiet_hours.start || "22:00";
    var end = prefs.quiet_hours.end || "08:00";

    // Get current local HH:MM in user's timezone
    var nowHHMM = (function(tz) {
      try {
        var fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        });
        var parts = fmt.formatToParts(new Date());
        var h = parts.find(function(p) { return p.type === "hour"; }).value;
        var m = parts.find(function(p) { return p.type === "minute"; }).value;
        return h + ":" + m;
      } catch (_) {
        var d = new Date();
        return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
      }
    })(tz);

    // Compare HH:MM strings lexicographically (works for 00:00–23:59)
    if (start <= end) {
      // Normal range e.g. 08:00–22:00
      return nowHHMM >= start && nowHHMM < end;
    } else {
      // Cross-midnight range e.g. 22:00–08:00
      return nowHHMM >= start || nowHHMM < end;
    }
  } catch (_) {
    return false; // malformed → don't suppress
  }
}

function _waNotifAllowed(user, channel, event) {
  var raw = user.getString("notification_prefs") || "";
  if (!raw || !raw.trim()) return true; // no prefs set → opt-in for all
  try {
    var prefs = JSON.parse(raw);
    // channels check
    var channels = (prefs && Array.isArray(prefs.channels)) ? prefs.channels : ["whatsapp", "email"];
    var chanOk = false;
    for (var ci = 0; ci < channels.length; ci++) {
      if (channels[ci] === channel) { chanOk = true; break; }
    }
    if (!chanOk) return false;
    // event check
    var events = (prefs && prefs.events) ? prefs.events : {};
    if (typeof events[event] === "boolean") return events[event];
    return true; // event not specified → opt-in
  } catch (_) {
    return true; // malformed JSON → opt-in
  }
}

function _sendTelegram(chatId, text) {
  var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
  if (!token) {
    console.log("[tg_notify] TELEGRAM_BOT_TOKEN not set — skip");
    return "skipped_no_token";
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

  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var lastOutcome = "sent";
  for (var i = 0; i < chunks.length; i++) {
    try {
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
        console.log("[tg_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
        lastOutcome = "failed";
      } else {
        console.log("[tg_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
      }
    } catch (chunkErr) {
      console.log("[tg_notify] chunk send error:", chunkErr);
      lastOutcome = "failed";
    }
  }
  return lastOutcome;
}

// ---------------------------------------------------------------------------
// Request fulfilled — approved → fulfilled transition notifies requester
// ---------------------------------------------------------------------------
onRecordAfterUpdateRequest(function(e) {
  // PB v0.22 Goja isolation: helpers inlined at top of callback so they are
  // visible at runtime (top-level function declarations are not reliably so).
  function _isInQuietHours(user) {
    var raw = user.getString("notification_prefs") || "";
    if (!raw || !raw.trim()) return false;
    try {
      var prefs = JSON.parse(raw);
      if (!prefs || !prefs.quiet_hours || !prefs.quiet_hours.enabled) return false;
      var tz = prefs.quiet_hours.timezone || "UTC";
      var start = prefs.quiet_hours.start || "22:00";
      var end = prefs.quiet_hours.end || "08:00";
      var nowHHMM = (function(tz) {
        try {
          var fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
          var parts = fmt.formatToParts(new Date());
          var h = parts.find(function(p) { return p.type === "hour"; }).value;
          var m = parts.find(function(p) { return p.type === "minute"; }).value;
          return h + ":" + m;
        } catch (_) {
          var d = new Date();
          return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
        }
      })(tz);
      if (start <= end) {
        return nowHHMM >= start && nowHHMM < end;
      } else {
        return nowHHMM >= start || nowHHMM < end;
      }
    } catch (_) {
      return false;
    }
  }
  function _waNotifAllowed(user, channel, event) {
    var raw = user.getString("notification_prefs") || "";
    if (!raw || !raw.trim()) return true;
    try {
      var prefs = JSON.parse(raw);
      var channels = (prefs && Array.isArray(prefs.channels)) ? prefs.channels : ["whatsapp", "email"];
      var chanOk = false;
      for (var ci = 0; ci < channels.length; ci++) {
        if (channels[ci] === channel) { chanOk = true; break; }
      }
      if (!chanOk) return false;
      var events = (prefs && prefs.events) ? prefs.events : {};
      if (typeof events[event] === "boolean") return events[event];
      return true;
    } catch (_) {
      return true;
    }
  }
  function _sendTelegram(chatId, text) {
    var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!token) {
      console.log("[tg_notify] TELEGRAM_BOT_TOKEN not set — skip");
      return "skipped_no_token";
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
    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var lastOutcome = "sent";
    for (var i = 0; i < chunks.length; i++) {
      try {
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
          console.log("[tg_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_notify] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  // Must run in try/catch — failure must NOT block the update response.
  try {
    var record = e.record;
    var original = e.record.originalCopy();

    var oldStatus = original.getString("status");
    var newStatus = record.getString("status");

    // Only fire on the approved → fulfilled transition
    if (!(oldStatus === "approved" && newStatus === "fulfilled")) return;

    // Look up requester
    var requesterId = record.getString("requester");
    if (!requesterId) return;

    var requester = null;
    try {
      requester = $app.dao().findRecordById("users", requesterId);
    } catch (e2) {
      console.log("[wa_auto_notify] requester lookup failed:", e2);
      return;
    }

    // Resolve shared message content (used by both WA and TG)
    var recipientName = requester.getString("name") || requester.getString("email") || "there";

    // Look up designated kit serial
    var kitSerial = "your kit";
    try {
      var kitId = record.getString("designated_kit");
      if (kitId) {
        var kit = $app.dao().findRecordById("kits", kitId);
        kitSerial = kit.getString("serial") || "your kit";
      }
    } catch (e3) {
      console.log("[wa_auto_notify] kit lookup failed:", e3);
    }

    // Look up target entity name
    var entityName = "";
    try {
      var entityId = record.getString("target_entity");
      if (entityId) {
        var entity = $app.dao().findRecordById("entities", entityId);
        entityName = entity.getString("name") || "";
      }
    } catch (e4) {
      console.log("[wa_auto_notify] entity lookup failed:", e4);
    }

    var deliveryDate = record.getString("delivery_date") || "";

    var msgText =
      "Hi " + recipientName + ", your kit request has been fulfilled.\n" +
      "Kit: " + kitSerial + "\n" +
      (entityName ? "Now at: " + entityName + "\n" : "") +
      (deliveryDate ? "Delivery date: " + deliveryDate : "");

    // ── WhatsApp branch ────────────────────────────────────────────────────
    // Guarded: requires WA creds + whatsapp channel pref + phone + not quiet.
    // Never early-returns from the handler — TG block below is always reachable.
    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
    if (phoneNumberId && waToken &&
        _waNotifAllowed(requester, "whatsapp", "request_fulfilled") &&
        !_isInQuietHours(requester)) {

      var recipientPhone = requester.getString("phone");
      if (recipientPhone) {
        // Strip leading "whatsapp:" prefix if present (normalize)
        var toPhone = recipientPhone;
        if (toPhone.indexOf("whatsapp:") === 0) toPhone = toPhone.substring("whatsapp:".length);

        var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";
        var payload = JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "text",
          text: { body: msgText }
        });

        var waSuccess = false;
        var wamid = "failed";

        try {
          var waRes = $http.send({
            method: "POST",
            url: apiUrl,
            body: payload,
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + waToken
            },
            timeout: 10000
          });

          if (waRes.statusCode >= 200 && waRes.statusCode < 300) {
            waSuccess = true;
            // Extract wamid from response
            try {
              var parsed = JSON.parse(waRes.raw);
              if (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) {
                wamid = parsed.messages[0].id;
              }
            } catch (_) {}
            console.log("[wa_auto_notify] request_fulfilled sent to " + toPhone + " wamid=" + wamid);
          } else {
            console.log("[wa_auto_notify] request_fulfilled Meta API " + waRes.statusCode + ": " + waRes.raw);
            // 4xx "outside window" or template error — swallow per spec
          }
        } catch (httpErr) {
          console.log("[wa_auto_notify] request_fulfilled HTTP error:", httpErr);
        }

        // Audit log — best-effort
        try {
          var waAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
          var waAuditRec = new Record(waAuditCol);
          waAuditRec.set("collection_name", "messages");
          waAuditRec.set("record_id", wamid);
          waAuditRec.set("actor", requesterId);
          waAuditRec.set("action", "send_whatsapp");
          waAuditRec.set("changes", JSON.stringify({
            to: toPhone,
            event: "request_fulfilled",
            success: waSuccess
          }));
          $app.dao().saveRecord(waAuditRec);
        } catch (auditErr) {
          console.log("[wa_auto_notify] audit_log write failed:", auditErr);
        }
      } else {
        console.log("[wa_auto_notify] request_fulfilled: WA allowed but no phone for user", requesterId);
      }
    }
    // ── end WhatsApp branch ────────────────────────────────────────────────

    // ── Telegram branch (Phase 6 — independent of WA gates) ────────────────
    // Reachable even if: WA creds absent, user has no phone, user opted out of WA.
    if (_waNotifAllowed(requester, "telegram", "request_fulfilled") &&
        !_isInQuietHours(requester)) {
      var tgChat = requester.getString("telegram_chat_id");
      if (tgChat) {
        var tgOutcome = _sendTelegram(tgChat, msgText);
        // Audit — best-effort; written even for skipped_no_token so branch is observable
        try {
          var tgAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
          var tgAuditRec = new Record(tgAuditCol);
          tgAuditRec.set("collection_name", "messages");
          tgAuditRec.set("record_id", tgChat);
          tgAuditRec.set("actor", requester.id);
          tgAuditRec.set("action", "send_telegram");
          tgAuditRec.set("changes", JSON.stringify({
            to: tgChat,
            event: "request_fulfilled",
            outcome: tgOutcome,
            chars: msgText.length
          }));
          $app.dao().saveRecord(tgAuditRec);
        } catch (tgAuditErr) {
          console.log("[tg_notify] audit_log write failed (request_fulfilled):", tgAuditErr);
        }
      }
    }
    // ── end Telegram branch ────────────────────────────────────────────────

  } catch (outerErr) {
    console.log("[wa_auto_notify] onRecordAfterUpdateRequest(requests) error:", outerErr);
  }
}, "requests");

// ---------------------------------------------------------------------------
// Request created — notify all admins with phone or telegram_chat_id for approval
// Each admin gets a short-id prompt: "approve <id6>" / "reject <id6>"
// $app.store() key: wa_approval_map:<short_id> → full request id (24h TTL)
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest(function(e) {
  // PB v0.22 Goja isolation: helpers inlined at top of callback so they are
  // visible at runtime (top-level function declarations are not reliably so).
  function _isInQuietHours(user) {
    var raw = user.getString("notification_prefs") || "";
    if (!raw || !raw.trim()) return false;
    try {
      var prefs = JSON.parse(raw);
      if (!prefs || !prefs.quiet_hours || !prefs.quiet_hours.enabled) return false;
      var tz = prefs.quiet_hours.timezone || "UTC";
      var start = prefs.quiet_hours.start || "22:00";
      var end = prefs.quiet_hours.end || "08:00";
      var nowHHMM = (function(tz) {
        try {
          var fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
          var parts = fmt.formatToParts(new Date());
          var h = parts.find(function(p) { return p.type === "hour"; }).value;
          var m = parts.find(function(p) { return p.type === "minute"; }).value;
          return h + ":" + m;
        } catch (_) {
          var d = new Date();
          return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
        }
      })(tz);
      if (start <= end) {
        return nowHHMM >= start && nowHHMM < end;
      } else {
        return nowHHMM >= start || nowHHMM < end;
      }
    } catch (_) {
      return false;
    }
  }
  function _waNotifAllowed(user, channel, event) {
    var raw = user.getString("notification_prefs") || "";
    if (!raw || !raw.trim()) return true;
    try {
      var prefs = JSON.parse(raw);
      var channels = (prefs && Array.isArray(prefs.channels)) ? prefs.channels : ["whatsapp", "email"];
      var chanOk = false;
      for (var ci = 0; ci < channels.length; ci++) {
        if (channels[ci] === channel) { chanOk = true; break; }
      }
      if (!chanOk) return false;
      var events = (prefs && prefs.events) ? prefs.events : {};
      if (typeof events[event] === "boolean") return events[event];
      return true;
    } catch (_) {
      return true;
    }
  }
  function _sendTelegram(chatId, text) {
    var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!token) {
      console.log("[tg_notify] TELEGRAM_BOT_TOKEN not set — skip");
      return "skipped_no_token";
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
    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var lastOutcome = "sent";
    for (var i = 0; i < chunks.length; i++) {
      try {
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
          console.log("[tg_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_notify] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  try {
    var record = e.record;
    var requestId = record.id;
    var shortId = requestId.slice(-6);

    // Store mapping from shortId → full requestId (24h TTL)
    try {
      var storeKey = "wa_approval_map:" + shortId;
      var ttlMs = 24 * 60 * 60 * 1000;
      $app.store().set(storeKey, JSON.stringify({ requestId: requestId, expires: Date.now() + ttlMs }));
    } catch (storeErr) {
      console.log("[wa_auto_notify] approval_map store failed:", storeErr);
    }

    // Look up requester name
    var requesterName = "Unknown";
    try {
      var requesterId = record.getString("requester");
      if (requesterId) {
        var requester = $app.dao().findRecordById("users", requesterId);
        requesterName = requester.getString("name") || requester.getString("email") || "Unknown";
      }
    } catch (e2) {
      console.log("[wa_auto_notify] request_pending requester lookup failed:", e2);
    }

    // Look up kit serial
    var kitSerial = "N/A";
    try {
      var kitId = record.getString("designated_kit");
      if (kitId) {
        var kit = $app.dao().findRecordById("kits", kitId);
        kitSerial = kit.getString("serial") || "N/A";
      }
    } catch (e3) {
      console.log("[wa_auto_notify] request_pending kit lookup failed:", e3);
    }

    // Look up target entity
    var targetName = "N/A";
    try {
      var targetId = record.getString("target_entity");
      if (targetId) {
        var target = $app.dao().findRecordById("entities", targetId);
        targetName = target.getString("name") || "N/A";
      }
    } catch (e4) {
      console.log("[wa_auto_notify] request_pending entity lookup failed:", e4);
    }

    var deliveryDate = record.getString("delivery_date") || "N/A";

    var msgText =
      "New request from " + requesterName + "\n" +
      "Kit: " + kitSerial + "\n" +
      "Target: " + targetName + "\n" +
      "Delivery: " + deliveryDate + "\n\n" +
      "Reply with:\n" +
      "- 'approve " + shortId + "' to approve\n" +
      "- 'reject " + shortId + "' to reject";

    // On-call routing: prefer admins currently on shift; fall back to all admins
    // Broadened query: include admins with phone OR telegram_chat_id
    function getCurrentOnCallAdmins() {
      try {
        var now = new Date();
        var shifts = $app.dao().findRecordsByFilter(
          "on_call_shifts",
          "start_at <= {:now} && end_at >= {:now}",
          "",
          100, 0,
          { now: now.toISOString() }
        );
        if (!shifts || shifts.length === 0) return null;
        var userIds = [];
        for (var si = 0; si < shifts.length; si++) {
          var uid = shifts[si].getString("user");
          if (uid) userIds.push(uid);
        }
        if (userIds.length === 0) return null;
        var quotedIds = userIds.map(function(id) { return '"' + id + '"'; }).join(",");
        var onCallAdmins = $app.dao().findRecordsByFilter(
          "users",
          "role = 'admin' && (phone != \"\" || telegram_chat_id != \"\") && id IN (" + quotedIds + ")",
          "",
          100, 0,
          {}
        );
        return onCallAdmins && onCallAdmins.length > 0 ? onCallAdmins : null;
      } catch (ocErr) {
        console.log("[wa_auto_notify] on-call lookup failed (fallback to all admins):", ocErr);
        return null;
      }
    }

    // Find all admins with phone or telegram_chat_id set and request_pending pref not false
    var admins = [];
    try {
      var onCallAdmins = getCurrentOnCallAdmins();
      if (onCallAdmins) {
        console.log("[wa_auto_notify] request_pending: on-call routing to " + onCallAdmins.length + " admin(s)");
        admins = onCallAdmins;
      } else {
        admins = $app.dao().findRecordsByFilter(
          "users",
          "role = 'admin' && (phone != \"\" || telegram_chat_id != \"\")",
          "",
          100,
          0,
          {}
        );
      }
    } catch (e5) {
      console.log("[wa_auto_notify] request_pending admin lookup failed:", e5);
      return;
    }

    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
    var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";

    for (var i = 0; i < admins.length; i++) {
      var admin = admins[i];

      // ── WhatsApp branch (per-admin) ────────────────────────────────────
      // Guarded: requires WA creds + whatsapp channel pref + phone + not quiet.
      // Does NOT continue/skip to next admin — TG block below must run too.
      if (phoneNumberId && waToken &&
          _waNotifAllowed(admin, "whatsapp", "request_pending") &&
          !_isInQuietHours(admin)) {

        var adminPhone = admin.getString("phone") || "";
        if (adminPhone) {
          var toPhone = adminPhone;
          if (toPhone.indexOf("whatsapp:") === 0) toPhone = toPhone.substring("whatsapp:".length);

          var payload = JSON.stringify({
            messaging_product: "whatsapp",
            to: toPhone,
            type: "text",
            text: { body: msgText }
          });

          var waSuccess = false;
          var wamid = "failed";

          try {
            var waRes = $http.send({
              method: "POST",
              url: apiUrl,
              body: payload,
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + waToken
              },
              timeout: 10000
            });

            if (waRes.statusCode >= 200 && waRes.statusCode < 300) {
              waSuccess = true;
              try {
                var parsed = JSON.parse(waRes.raw);
                if (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) {
                  wamid = parsed.messages[0].id;
                }
              } catch (_) {}
              console.log("[wa_auto_notify] request_pending sent to admin " + admin.id + " phone=" + toPhone + " wamid=" + wamid);
            } else {
              console.log("[wa_auto_notify] request_pending Meta API " + waRes.statusCode + " for admin " + admin.id + ": " + waRes.raw);
            }
          } catch (httpErr) {
            console.log("[wa_auto_notify] request_pending HTTP error for admin " + admin.id + ":", httpErr);
          }

          // Audit log — best-effort per admin
          try {
            var waAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
            var waAuditRec = new Record(waAuditCol);
            waAuditRec.set("collection_name", "messages");
            waAuditRec.set("record_id", wamid);
            waAuditRec.set("actor", admin.id);
            waAuditRec.set("action", "send_whatsapp");
            waAuditRec.set("changes", JSON.stringify({
              to: toPhone,
              event: "request_pending",
              request_id: requestId,
              short_id: shortId,
              success: waSuccess
            }));
            $app.dao().saveRecord(waAuditRec);
          } catch (auditErr) {
            console.log("[wa_auto_notify] audit_log write failed (request_pending):", auditErr);
          }
        } else {
          console.log("[wa_auto_notify] request_pending: WA allowed but no phone for admin", admin.id);
        }
      }
      // ── end WhatsApp branch ────────────────────────────────────────────

      // ── Telegram branch (per-admin, independent of WA gates) ───────────
      // Reachable even if: WA creds absent, admin has no phone, admin opted out of WA.
      if (_waNotifAllowed(admin, "telegram", "request_pending") &&
          !_isInQuietHours(admin)) {
        var tgChat = admin.getString("telegram_chat_id");
        if (tgChat) {
          var tgOutcome = _sendTelegram(tgChat, msgText);
          // Audit — best-effort; written even for skipped_no_token so branch is observable
          try {
            var tgAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
            var tgAuditRec = new Record(tgAuditCol);
            tgAuditRec.set("collection_name", "messages");
            tgAuditRec.set("record_id", tgChat);
            tgAuditRec.set("actor", admin.id);
            tgAuditRec.set("action", "send_telegram");
            tgAuditRec.set("changes", JSON.stringify({
              to: tgChat,
              event: "request_pending",
              request_id: requestId,
              short_id: shortId,
              outcome: tgOutcome,
              chars: msgText.length
            }));
            $app.dao().saveRecord(tgAuditRec);
          } catch (tgAuditErr) {
            console.log("[tg_notify] audit_log write failed (request_pending):", tgAuditErr);
          }
        }
      }
      // ── end Telegram branch ────────────────────────────────────────────
    }

  } catch (outerErr) {
    console.log("[wa_auto_notify] onRecordAfterCreateRequest(requests) error:", outerErr);
  }
}, "requests");

// ---------------------------------------------------------------------------
// Transaction created — kit moved notification (OPT-IN via WHATSAPP_NOTIFY_MOVES=1)
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest(function(e) {
  // PB v0.22 Goja isolation: helpers inlined at top of callback so they are
  // visible at runtime (top-level function declarations are not reliably so).
  function _isInQuietHours(user) {
    var raw = user.getString("notification_prefs") || "";
    if (!raw || !raw.trim()) return false;
    try {
      var prefs = JSON.parse(raw);
      if (!prefs || !prefs.quiet_hours || !prefs.quiet_hours.enabled) return false;
      var tz = prefs.quiet_hours.timezone || "UTC";
      var start = prefs.quiet_hours.start || "22:00";
      var end = prefs.quiet_hours.end || "08:00";
      var nowHHMM = (function(tz) {
        try {
          var fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
          var parts = fmt.formatToParts(new Date());
          var h = parts.find(function(p) { return p.type === "hour"; }).value;
          var m = parts.find(function(p) { return p.type === "minute"; }).value;
          return h + ":" + m;
        } catch (_) {
          var d = new Date();
          return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2);
        }
      })(tz);
      if (start <= end) {
        return nowHHMM >= start && nowHHMM < end;
      } else {
        return nowHHMM >= start || nowHHMM < end;
      }
    } catch (_) {
      return false;
    }
  }
  function _waNotifAllowed(user, channel, event) {
    var raw = user.getString("notification_prefs") || "";
    if (!raw || !raw.trim()) return true;
    try {
      var prefs = JSON.parse(raw);
      var channels = (prefs && Array.isArray(prefs.channels)) ? prefs.channels : ["whatsapp", "email"];
      var chanOk = false;
      for (var ci = 0; ci < channels.length; ci++) {
        if (channels[ci] === channel) { chanOk = true; break; }
      }
      if (!chanOk) return false;
      var events = (prefs && prefs.events) ? prefs.events : {};
      if (typeof events[event] === "boolean") return events[event];
      return true;
    } catch (_) {
      return true;
    }
  }
  function _sendTelegram(chatId, text) {
    var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!token) {
      console.log("[tg_notify] TELEGRAM_BOT_TOKEN not set — skip");
      return "skipped_no_token";
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
    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var lastOutcome = "sent";
    for (var i = 0; i < chunks.length; i++) {
      try {
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
          console.log("[tg_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_notify] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  try {
    // Opt-in guard
    var notifyMoves = $os.getenv("WHATSAPP_NOTIFY_MOVES") || "";
    if (notifyMoves !== "1") return;

    var record = e.record;
    var kitId = record.getString("kit");
    if (!kitId) return;

    // Check if this kit has an active approved/fulfilled request with a requester
    var relatedRequests = [];
    try {
      relatedRequests = $app.dao().findRecordsByFilter(
        "requests",
        "designated_kit = {:kitId} && status = 'approved'",
        "-created",
        1,
        0,
        { kitId: kitId }
      );
    } catch (e2) {
      console.log("[wa_auto_notify] kit_moved request lookup failed:", e2);
      return;
    }

    if (!relatedRequests || relatedRequests.length === 0) return;

    var req = relatedRequests[0];
    var requesterId = req.getString("requester");
    if (!requesterId) return;

    var requester = null;
    try {
      requester = $app.dao().findRecordById("users", requesterId);
    } catch (e3) {
      console.log("[wa_auto_notify] kit_moved requester lookup failed:", e3);
      return;
    }

    // Resolve shared message content (used by both WA and TG)
    var recipientName = requester.getString("name") || requester.getString("email") || "there";

    // Look up kit serial
    var kitSerial = kitId;
    try {
      var kit = $app.dao().findRecordById("kits", kitId);
      kitSerial = kit.getString("serial") || kitId;
    } catch (_) {}

    // Look up to_entity name
    var toEntityName = "";
    try {
      var toEntityId = record.getString("to_entity");
      if (toEntityId) {
        var toEntity = $app.dao().findRecordById("entities", toEntityId);
        toEntityName = toEntity.getString("name") || "";
      }
    } catch (_) {}

    var msgText =
      "Hi " + recipientName + ", your kit has been moved.\n" +
      "Kit: " + kitSerial + "\n" +
      (toEntityName ? "Now at: " + toEntityName : "");

    // ── WhatsApp branch ────────────────────────────────────────────────────
    // Guarded: requires WA creds + whatsapp channel pref + phone + not quiet.
    // Never early-returns from the handler — TG block below is always reachable.
    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
    if (phoneNumberId && waToken &&
        _waNotifAllowed(requester, "whatsapp", "kit_moved") &&
        !_isInQuietHours(requester)) {

      var recipientPhone = requester.getString("phone");
      if (recipientPhone) {
        var toPhone = recipientPhone;
        if (toPhone.indexOf("whatsapp:") === 0) toPhone = toPhone.substring("whatsapp:".length);

        var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";
        var payload = JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "text",
          text: { body: msgText }
        });

        var waSuccess = false;
        var wamid = "failed";

        try {
          var waRes = $http.send({
            method: "POST",
            url: apiUrl,
            body: payload,
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + waToken
            },
            timeout: 10000
          });

          if (waRes.statusCode >= 200 && waRes.statusCode < 300) {
            waSuccess = true;
            try {
              var parsed = JSON.parse(waRes.raw);
              if (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) {
                wamid = parsed.messages[0].id;
              }
            } catch (_) {}
            console.log("[wa_auto_notify] kit_moved sent to " + toPhone + " wamid=" + wamid);
          } else {
            console.log("[wa_auto_notify] kit_moved Meta API " + waRes.statusCode + ": " + waRes.raw);
          }
        } catch (httpErr) {
          console.log("[wa_auto_notify] kit_moved HTTP error:", httpErr);
        }

        // Audit log — best-effort
        try {
          var waAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
          var waAuditRec = new Record(waAuditCol);
          waAuditRec.set("collection_name", "messages");
          waAuditRec.set("record_id", wamid);
          waAuditRec.set("actor", requesterId);
          waAuditRec.set("action", "send_whatsapp");
          waAuditRec.set("changes", JSON.stringify({
            to: toPhone,
            event: "kit_moved",
            success: waSuccess
          }));
          $app.dao().saveRecord(waAuditRec);
        } catch (auditErr) {
          console.log("[wa_auto_notify] audit_log write failed (kit_moved):", auditErr);
        }
      } else {
        console.log("[wa_auto_notify] kit_moved: WA allowed but no phone for user", requesterId);
      }
    }
    // ── end WhatsApp branch ────────────────────────────────────────────────

    // ── Telegram branch (Phase 6 — independent of WA gates) ────────────────
    // Reachable even if: WA creds absent, user has no phone, user opted out of WA.
    if (_waNotifAllowed(requester, "telegram", "kit_moved") &&
        !_isInQuietHours(requester)) {
      var tgChat = requester.getString("telegram_chat_id");
      if (tgChat) {
        var tgOutcome = _sendTelegram(tgChat, msgText);
        // Audit — best-effort; written even for skipped_no_token so branch is observable
        try {
          var tgAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
          var tgAuditRec = new Record(tgAuditCol);
          tgAuditRec.set("collection_name", "messages");
          tgAuditRec.set("record_id", tgChat);
          tgAuditRec.set("actor", requester.id);
          tgAuditRec.set("action", "send_telegram");
          tgAuditRec.set("changes", JSON.stringify({
            to: tgChat,
            event: "kit_moved",
            outcome: tgOutcome,
            chars: msgText.length
          }));
          $app.dao().saveRecord(tgAuditRec);
        } catch (tgAuditErr) {
          console.log("[tg_notify] audit_log write failed (kit_moved):", tgAuditErr);
        }
      }
    }
    // ── end Telegram branch ────────────────────────────────────────────────

  } catch (outerErr) {
    console.log("[wa_auto_notify] onRecordAfterCreateRequest(transactions) error:", outerErr);
  }
}, "transactions");
