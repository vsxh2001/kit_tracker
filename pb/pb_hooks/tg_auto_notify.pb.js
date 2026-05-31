/// <reference path="../pb_data/types.d.ts" />
// Telegram auto-notifications for key kit-tracker events.
//
// Hooks:
//   onRecordAfterUpdateRequest("requests") — approved → fulfilled: notify requester via Telegram.
//   onRecordAfterCreateRequest("requests") — new request: notify all admins via Telegram.
//   onRecordAfterCreateRequest("transactions") — kit moved: opt-in via WHATSAPP_NOTIFY_MOVES=1.
//
// Environment:
//   TELEGRAM_BOT_TOKEN       — Telegram bot token from BotFather (required; skip-silently when absent)
//   WHATSAPP_NOTIFY_MOVES=1  — opt-in gate for transaction-create notifications (default off)
//
// PB v0.22 Goja isolation: ALL helpers inlined per callback. No cross-callback scope.
// Best-effort: failed sends log to audit_log but never block the underlying save.
// audit_log.actor is required — every write sets actor to a valid users.id.

// ---------------------------------------------------------------------------
// Request fulfilled — approved → fulfilled transition notifies requester
// ---------------------------------------------------------------------------
onRecordAfterUpdateRequest(function(e) {
  // PB v0.22 Goja isolation: helpers inlined inside callback.
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
  function _notifAllowed(user, channel, event) {
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
      console.log("[tg_auto_notify] TELEGRAM_BOT_TOKEN not set — skip");
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
          console.log("[tg_auto_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_auto_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_auto_notify] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

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
      console.log("[tg_auto_notify] requester lookup failed:", e2);
      return;
    }

    // Resolve message content
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
      console.log("[tg_auto_notify] kit lookup failed:", e3);
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
      console.log("[tg_auto_notify] entity lookup failed:", e4);
    }

    var deliveryDate = record.getString("delivery_date") || "";

    var msgText =
      "Hi " + recipientName + ", your kit request has been fulfilled.\n" +
      "Kit: " + kitSerial + "\n" +
      (entityName ? "Now at: " + entityName + "\n" : "") +
      (deliveryDate ? "Delivery date: " + deliveryDate : "");

    // ── Telegram branch ────────────────────────────────────────────────────
    if (_notifAllowed(requester, "telegram", "request_fulfilled") &&
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
          console.log("[tg_auto_notify] audit_log write failed (request_fulfilled):", tgAuditErr);
        }
      }
    }
    // ── end Telegram branch ────────────────────────────────────────────────

  } catch (outerErr) {
    console.log("[tg_auto_notify] onRecordAfterUpdateRequest(requests) error:", outerErr);
  }
}, "requests");

// ---------------------------------------------------------------------------
// Request created — notify all admins with telegram_chat_id for approval
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest(function(e) {
  // PB v0.22 Goja isolation: helpers inlined inside callback.
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
  function _notifAllowed(user, channel, event) {
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
      console.log("[tg_auto_notify] TELEGRAM_BOT_TOKEN not set — skip");
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
          console.log("[tg_auto_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_auto_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_auto_notify] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  try {
    var record = e.record;
    var requestId = record.id;
    var shortId = requestId.slice(-6);

    // Look up requester name
    var requesterName = "Unknown";
    try {
      var requesterId = record.getString("requester");
      if (requesterId) {
        var requester = $app.dao().findRecordById("users", requesterId);
        requesterName = requester.getString("name") || requester.getString("email") || "Unknown";
      }
    } catch (e2) {
      console.log("[tg_auto_notify] request_pending requester lookup failed:", e2);
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
      console.log("[tg_auto_notify] request_pending kit lookup failed:", e3);
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
      console.log("[tg_auto_notify] request_pending entity lookup failed:", e4);
    }

    var deliveryDate = record.getString("delivery_date") || "N/A";

    var msgText =
      "New request from " + requesterName + "\n" +
      "Kit: " + kitSerial + "\n" +
      "Target: " + targetName + "\n" +
      "Delivery: " + deliveryDate + "\n\n" +
      "Reply with:\n" +
      "- /approve " + shortId + "\n" +
      "- /reject " + shortId;

    // Find all admins with telegram_chat_id set
    var admins = [];
    try {
      admins = $app.dao().findRecordsByFilter(
        "users",
        "role = 'admin' && telegram_chat_id != \"\"",
        "",
        100,
        0,
        {}
      );
    } catch (e5) {
      console.log("[tg_auto_notify] request_pending admin lookup failed:", e5);
      return;
    }

    for (var i = 0; i < admins.length; i++) {
      var admin = admins[i];

      // ── Telegram branch (per-admin) ────────────────────────────────────
      if (_notifAllowed(admin, "telegram", "request_pending") &&
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
            console.log("[tg_auto_notify] audit_log write failed (request_pending):", tgAuditErr);
          }
        }
      }
      // ── end Telegram branch ────────────────────────────────────────────
    }

  } catch (outerErr) {
    console.log("[tg_auto_notify] onRecordAfterCreateRequest(requests) error:", outerErr);
  }
}, "requests");

// ---------------------------------------------------------------------------
// Transaction created — kit moved notification (OPT-IN via WHATSAPP_NOTIFY_MOVES=1)
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest(function(e) {
  // PB v0.22 Goja isolation: helpers inlined inside callback.
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
  function _notifAllowed(user, channel, event) {
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
      console.log("[tg_auto_notify] TELEGRAM_BOT_TOKEN not set — skip");
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
          console.log("[tg_auto_notify] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_auto_notify] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_auto_notify] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  try {
    // Opt-in guard (same env var as before)
    var notifyMoves = $os.getenv("WHATSAPP_NOTIFY_MOVES") || "";
    if (notifyMoves !== "1") return;

    var record = e.record;
    var kitId = record.getString("kit");
    if (!kitId) return;

    // Check if this kit has an active approved request with a requester
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
      console.log("[tg_auto_notify] kit_moved request lookup failed:", e2);
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
      console.log("[tg_auto_notify] kit_moved requester lookup failed:", e3);
      return;
    }

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

    // ── Telegram branch ────────────────────────────────────────────────────
    if (_notifAllowed(requester, "telegram", "kit_moved") &&
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
          console.log("[tg_auto_notify] audit_log write failed (kit_moved):", tgAuditErr);
        }
      }
    }
    // ── end Telegram branch ────────────────────────────────────────────────

  } catch (outerErr) {
    console.log("[tg_auto_notify] onRecordAfterCreateRequest(transactions) error:", outerErr);
  }
}, "transactions");
