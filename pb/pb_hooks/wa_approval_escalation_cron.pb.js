/// <reference path="../pb_data/types.d.ts" />
// Tier 4: Smart escalation — WhatsApp approval requests unanswered for >1h.
//
// Every 5 minutes, scans open requests created more than WA_APPROVAL_ESCALATION_HOURS ago
// (default 1h). For each such request that has not yet been escalated (tracked in
// $app.store() with key "wa_approval_pending:<request_id>"), sends a WhatsApp message
// to ALL admins with a phone number or telegram_chat_id (bypassing on-call routing).
//
// Trade-off: $app.store() resets on PB restart → re-escalation possible (rare).
// For MVP this is acceptable vs. requiring a DB migration.
//
// Environment:
//   WHATSAPP_PHONE_NUMBER_ID  — Meta phone number ID
//   WHATSAPP_TOKEN            — Meta bearer token
//   WA_APPROVAL_ESCALATION_HOURS — threshold in hours (default 1)
//
// Notification pref gate:
//   events.request_escalation (default true) — admin can opt out.
//
// PB v0.22 Goja isolation: all logic inlined. NO module-level vars.

// ---------------------------------------------------------------------------
// _sendTelegramEscalation(chatId, text) — canonical source; kept as dead code.
// PB v0.22 Goja isolation: top-level function declarations are NOT reliably
// visible inside cronAdd/routerAdd callbacks at runtime. The live copy is
// inlined at the top of the cronAdd callback below. The /_test/ routerAdd
// route inlines its own copy (inlineSendTelegram). Do not call this directly.
// ---------------------------------------------------------------------------
function _sendTelegramEscalation(chatId, text) {
  var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
  if (!token) {
    console.log("[tg_escalation] TELEGRAM_BOT_TOKEN not set — skip");
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
        console.log("[tg_escalation] Telegram API error status=" + res.statusCode + " body=" + res.raw);
        lastOutcome = "failed";
      } else {
        console.log("[tg_escalation] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
      }
    } catch (chunkErr) {
      console.log("[tg_escalation] chunk send error:", chunkErr);
      lastOutcome = "failed";
    }
  }
  return lastOutcome;
}

cronAdd("wa_approval_escalation", "*/5 * * * *", function() {
  // PB v0.22 Goja isolation: _sendTelegramEscalation inlined here so it is
  // visible at runtime (top-level function declarations are not reliably so).
  function _sendTelegramEscalation(chatId, text) {
    var token = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!token) {
      console.log("[tg_escalation] TELEGRAM_BOT_TOKEN not set — skip");
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
          console.log("[tg_escalation] Telegram API error status=" + res.statusCode + " body=" + res.raw);
          lastOutcome = "failed";
        } else {
          console.log("[tg_escalation] sent chunk " + (i + 1) + "/" + chunks.length + " to chatId=" + chatId);
        }
      } catch (chunkErr) {
        console.log("[tg_escalation] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  try {
    var thresholdHours = parseFloat($os.getenv("WA_APPROVAL_ESCALATION_HOURS") || "1");
    if (isNaN(thresholdHours) || thresholdHours <= 0) thresholdHours = 1;
    var thresholdMs = thresholdHours * 60 * 60 * 1000;

    var now = new Date();
    var cutoff = new Date(now.getTime() - thresholdMs);
    // PB filter uses ISO-like format: "YYYY-MM-DD HH:MM:SS.sssZ"
    var cutoffStr = cutoff.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

    console.log("[wa_escalation] tick at " + now.toISOString() + " — cutoff=" + cutoffStr + " threshold=" + thresholdHours + "h");

    // 1. Fetch open requests older than threshold
    var openRequests = [];
    try {
      openRequests = $app.dao().findRecordsByFilter(
        "requests",
        "status = 'open' && created <= {:cutoff}",
        "-created",
        200,
        0,
        { cutoff: cutoffStr }
      );
    } catch (fetchErr) {
      console.log("[wa_escalation] failed to fetch open requests:", fetchErr);
      return;
    }

    if (!openRequests || openRequests.length === 0) {
      console.log("[wa_escalation] no open requests older than " + thresholdHours + "h");
      return;
    }

    console.log("[wa_escalation] found " + openRequests.length + " open request(s) older than " + thresholdHours + "h");

    // 2. Fetch all admins with phone or telegram_chat_id (broadened for TG-only admins)
    var admins = [];
    try {
      admins = $app.dao().findRecordsByFilter(
        "users",
        "role = 'admin' && (phone != \"\" || telegram_chat_id != \"\")",
        "",
        100,
        0,
        {}
      );
    } catch (adminErr) {
      console.log("[wa_escalation] failed to fetch admins:", adminErr);
      return;
    }

    if (!admins || admins.length === 0) {
      console.log("[wa_escalation] no admins with phone or telegram_chat_id — nothing to escalate to");
      return;
    }

    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
    var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";

    // 3. For each open request, check if already escalated
    for (var ri = 0; ri < openRequests.length; ri++) {
      var req = openRequests[ri];
      var requestId = req.id;
      var escalationKey = "wa_approval_pending:" + requestId;

      // Check escalation store
      var alreadyEscalated = false;
      try {
        var storeRaw = $app.store().get(escalationKey);
        if (storeRaw) {
          var storeEntry = JSON.parse(storeRaw);
          if (storeEntry && storeEntry.escalated === true) {
            alreadyEscalated = true;
          }
        }
      } catch (_) {}

      if (alreadyEscalated) {
        console.log("[wa_escalation] request " + requestId + " already escalated — skip");
        continue;
      }

      // Build escalation message
      var shortId = requestId.slice(-6);

      var requesterName = "Unknown";
      try {
        var requesterId = req.getString("requester");
        if (requesterId) {
          var requester = $app.dao().findRecordById("users", requesterId);
          requesterName = requester.getString("name") || requester.getString("email") || "Unknown";
        }
      } catch (e2) {
        console.log("[wa_escalation] requester lookup failed for request " + requestId + ":", e2);
      }

      var kitSerial = "N/A";
      try {
        var kitId = req.getString("designated_kit");
        if (kitId) {
          var kit = $app.dao().findRecordById("kits", kitId);
          kitSerial = kit.getString("serial") || "N/A";
        }
      } catch (e3) {
        console.log("[wa_escalation] kit lookup failed for request " + requestId + ":", e3);
      }

      var ageHours = Math.round(thresholdHours);
      var msgText =
        "⚠️ Request awaiting action for >" + ageHours + "h\n" +
        "Kit: " + kitSerial + "\n" +
        "Requested by: " + requesterName + "\n\n" +
        "Reply with:\n" +
        "- 'approve " + shortId + "' to approve\n" +
        "- 'reject " + shortId + "' to reject";

      // 4. Send to all admins (pref gate: request_escalation)
      var sentToAtLeastOne = false;

      for (var ai = 0; ai < admins.length; ai++) {
        var admin = admins[ai];

        // ── WhatsApp branch (per-admin) ──────────────────────────────────
        // Guarded: requires WA creds + whatsapp channel pref + phone + not quiet.
        // Does NOT continue to next admin — TG block below must run too.
        var waChannelOk = false;
        var waEventOk = true;
        var waQuietOk = true;
        try {
          var waPrefRaw = admin.getString("notification_prefs") || "";
          if (waPrefRaw && waPrefRaw.trim()) {
            var waPrefs = JSON.parse(waPrefRaw);
            var waChannels = Array.isArray(waPrefs && waPrefs.channels) ? waPrefs.channels : ["whatsapp", "email"];
            for (var wci = 0; wci < waChannels.length; wci++) {
              if (waChannels[wci] === "whatsapp") { waChannelOk = true; break; }
            }
            if (waChannelOk) {
              var waEvents = (waPrefs && waPrefs.events) ? waPrefs.events : {};
              if (typeof waEvents["request_escalation"] === "boolean") {
                waEventOk = waEvents["request_escalation"];
              }
            }
          } else {
            waChannelOk = true; // no prefs → opt-in
          }
          // Quiet hours
          var waQhRaw = admin.getString("notification_prefs") || "";
          if (waQhRaw && waQhRaw.trim()) {
            try {
              var waQhPrefs = JSON.parse(waQhRaw);
              if (waQhPrefs && waQhPrefs.quiet_hours && waQhPrefs.quiet_hours.enabled) {
                var qhTz = waQhPrefs.quiet_hours.timezone || "UTC";
                var qhStart = waQhPrefs.quiet_hours.start || "22:00";
                var qhEnd = waQhPrefs.quiet_hours.end || "08:00";
                var qhFmt = new Intl.DateTimeFormat("en-US", { timeZone: qhTz, hour: "2-digit", minute: "2-digit", hour12: false });
                var qhParts = qhFmt.formatToParts(new Date());
                var qhH = qhParts.find(function(p) { return p.type === "hour"; }).value;
                var qhM = qhParts.find(function(p) { return p.type === "minute"; }).value;
                var qhNow = qhH + ":" + qhM;
                if (qhStart <= qhEnd) {
                  waQuietOk = !(qhNow >= qhStart && qhNow < qhEnd);
                } else {
                  waQuietOk = !(qhNow >= qhStart || qhNow < qhEnd);
                }
              }
            } catch (_) {}
          }
        } catch (_) {
          waChannelOk = true;
        }

        if (phoneNumberId && waToken && waChannelOk && waEventOk && waQuietOk) {
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
                sentToAtLeastOne = true;
                console.log("[wa_escalation] escalation sent to admin " + admin.id + " phone=" + toPhone + " request=" + requestId + " wamid=" + wamid);
              } else {
                console.log("[wa_escalation] Meta API " + waRes.statusCode + " for admin " + admin.id + ": " + waRes.raw);
              }
            } catch (httpErr) {
              console.log("[wa_escalation] HTTP error for admin " + admin.id + ":", httpErr);
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
                event: "request_escalation",
                request_id: requestId,
                short_id: shortId,
                success: waSuccess
              }));
              $app.dao().saveRecord(waAuditRec);
            } catch (auditErr) {
              console.log("[wa_escalation] audit_log write failed for admin " + admin.id + ":", auditErr);
            }
          }
        }
        // ── end WhatsApp branch ────────────────────────────────────────────

        // ── Telegram branch (per-admin, independent of WA gates) ────────────
        // Reachable even if: WA creds absent, admin has no phone, admin opted out of WA.
        var tgChannelOk = false;
        var tgEventOk = true;
        var tgQuietOk = true;
        try {
          var tgPrefRaw = admin.getString("notification_prefs") || "";
          if (tgPrefRaw && tgPrefRaw.trim()) {
            var tgPrefs = JSON.parse(tgPrefRaw);
            var tgChannels = Array.isArray(tgPrefs && tgPrefs.channels) ? tgPrefs.channels : ["whatsapp", "email"];
            for (var tci = 0; tci < tgChannels.length; tci++) {
              if (tgChannels[tci] === "telegram") { tgChannelOk = true; break; }
            }
            if (tgChannelOk) {
              var tgEvents = (tgPrefs && tgPrefs.events) ? tgPrefs.events : {};
              if (typeof tgEvents["request_escalation"] === "boolean") {
                tgEventOk = tgEvents["request_escalation"];
              }
            }
            // Quiet hours (reuse parsed prefs)
            if (tgPrefs && tgPrefs.quiet_hours && tgPrefs.quiet_hours.enabled) {
              var tqTz = tgPrefs.quiet_hours.timezone || "UTC";
              var tqStart = tgPrefs.quiet_hours.start || "22:00";
              var tqEnd = tgPrefs.quiet_hours.end || "08:00";
              try {
                var tqFmt = new Intl.DateTimeFormat("en-US", { timeZone: tqTz, hour: "2-digit", minute: "2-digit", hour12: false });
                var tqParts = tqFmt.formatToParts(new Date());
                var tqH = tqParts.find(function(p) { return p.type === "hour"; }).value;
                var tqM = tqParts.find(function(p) { return p.type === "minute"; }).value;
                var tqNow = tqH + ":" + tqM;
                if (tqStart <= tqEnd) {
                  tgQuietOk = !(tqNow >= tqStart && tqNow < tqEnd);
                } else {
                  tgQuietOk = !(tqNow >= tqStart || tqNow < tqEnd);
                }
              } catch (_) {}
            }
          }
          // no prefs → tgChannelOk stays false (telegram is opt-in)
        } catch (_) {}

        if (tgChannelOk && tgEventOk && tgQuietOk) {
          var tgChatId = admin.getString("telegram_chat_id");
          if (tgChatId) {
            var tgOutcome = _sendTelegramEscalation(tgChatId, msgText);
            if (tgOutcome === "sent") sentToAtLeastOne = true;
            // Audit — best-effort; written even for skipped_no_token so branch is observable
            try {
              var tgAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
              var tgAuditRec = new Record(tgAuditCol);
              tgAuditRec.set("collection_name", "messages");
              tgAuditRec.set("record_id", tgChatId);
              tgAuditRec.set("actor", admin.id);
              tgAuditRec.set("action", "send_telegram");
              tgAuditRec.set("changes", JSON.stringify({
                to: tgChatId,
                event: "request_escalation",
                request_id: requestId,
                short_id: shortId,
                outcome: tgOutcome,
                chars: msgText.length
              }));
              $app.dao().saveRecord(tgAuditRec);
            } catch (tgAuditErr) {
              console.log("[tg_escalation] audit_log write failed for admin " + admin.id + ":", tgAuditErr);
            }
          }
        }
        // ── end Telegram branch ────────────────────────────────────────────
      }

      // 5. Mark as escalated in store (24h TTL)
      if (sentToAtLeastOne) {
        try {
          var ttlMs = 24 * 60 * 60 * 1000;
          $app.store().set(escalationKey, JSON.stringify({
            escalated: true,
            escalated_at: now.toISOString(),
            request_id: requestId,
            expires: now.getTime() + ttlMs
          }));
          console.log("[wa_escalation] marked request " + requestId + " as escalated in store");
        } catch (storeErr) {
          console.log("[wa_escalation] store.set failed for request " + requestId + ":", storeErr);
        }
      }
    }

    console.log("[wa_escalation] tick done");
  } catch (outerErr) {
    console.log("[wa_escalation] unhandled error:", outerErr);
  }
});

// ---------------------------------------------------------------------------
// POST /_test/wa-approval-escalation
// Dry-run for tests — admin only. Runs the full escalation check logic
// (DB queries, pref gate, dedup) but skips the actual WA HTTP send.
// Marks the $app.store() as if a send succeeded so dedup tests work.
//
// IMPORTANT (Goja isolation): routerAdd callbacks run in an isolated scope.
// Top-level helpers (_sendTelegramEscalation) are NOT visible here.
// The Telegram send logic is therefore INLINED inside this callback.
//
// Query params:
//   threshold_hours=<float>  (default 0 — all open requests qualify)
//
// Returns:
//   { skipped: "no_pending_requests" }
//   { fired: true, open_requests, admin_phones, escalated, already_escalated,
//     tg_sent (count of send_telegram audit rows written in this run) }
// ---------------------------------------------------------------------------
routerAdd("POST", "/_test/wa-approval-escalation", function(c) {
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  var thresholdHours = parseFloat(c.queryParam("threshold_hours") || "0");
  if (isNaN(thresholdHours) || thresholdHours < 0) thresholdHours = 0;
  var thresholdMs = thresholdHours * 60 * 60 * 1000;

  var now = new Date();
  var cutoff = new Date(now.getTime() - thresholdMs);
  var cutoffStr = cutoff.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  var openRequests = [];
  try {
    // threshold_hours=0 means "no minimum age" — skip cutoff filter to avoid
    // the same-second race where cutoffStr (truncated to seconds) is earlier
    // than the request's sub-second `created` timestamp.
    var filterStr = thresholdHours > 0
      ? "status = 'open' && created <= {:cutoff}"
      : "status = 'open'";
    var filterParams = thresholdHours > 0 ? { cutoff: cutoffStr } : {};
    openRequests = $app.dao().findRecordsByFilter(
      "requests",
      filterStr,
      "-created", 200, 0,
      filterParams
    );
  } catch (e) {
    return c.json(500, { error: "requests fetch error: " + String(e) });
  }

  if (!openRequests || openRequests.length === 0) {
    return c.json(200, { fired: true, skipped: "no_pending_requests", open_requests: 0, admin_phones: 0, escalated: 0, already_escalated: 0, tg_sent: 0 });
  }

  // Broadened admin query: include admins with phone OR telegram_chat_id
  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter(
      "users", "role = 'admin' && (phone != \"\" || telegram_chat_id != \"\")",
      "", 100, 0, {}
    );
  } catch (e) {
    return c.json(500, { error: "admins fetch error: " + String(e) });
  }

  var adminCount = admins ? admins.length : 0;
  if (adminCount === 0) {
    return c.json(200, { fired: true, open_requests: openRequests.length, admin_phones: 0, escalated: 0, already_escalated: 0, tg_sent: 0 });
  }

  var escalatedCount = 0;
  var alreadyEscalatedCount = 0;
  var tgSentCount = 0;

  // Inline Telegram send (cannot call _sendTelegramEscalation from routerAdd — Goja isolation)
  function inlineSendTelegram(chatId, text) {
    var tgToken = $os.getenv("TELEGRAM_BOT_TOKEN") || "";
    if (!tgToken) {
      console.log("[tg_escalation/_test] TELEGRAM_BOT_TOKEN not set — skip");
      return "skipped_no_token";
    }
    var MAX = 4000;
    var chunks = [];
    var remaining = text;
    while (remaining.length > MAX) {
      var breakAt = -1;
      var dbl = remaining.lastIndexOf("\n\n", MAX);
      if (dbl > 0) { breakAt = dbl + 2; }
      else {
        var nl = remaining.lastIndexOf("\n", MAX);
        if (nl > 0) { breakAt = nl + 1; }
        else {
          var sp = remaining.lastIndexOf(" ", MAX);
          breakAt = sp > 0 ? sp + 1 : MAX;
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());

    var tgUrl = "https://api.telegram.org/bot" + tgToken + "/sendMessage";
    var lastOutcome = "sent";
    for (var ci = 0; ci < chunks.length; ci++) {
      try {
        var tgRes = $http.send({
          url: tgUrl,
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
        if (tgRes.statusCode < 200 || tgRes.statusCode >= 300) {
          console.log("[tg_escalation/_test] Telegram API error status=" + tgRes.statusCode);
          lastOutcome = "failed";
        }
      } catch (chunkErr) {
        console.log("[tg_escalation/_test] chunk send error:", chunkErr);
        lastOutcome = "failed";
      }
    }
    return lastOutcome;
  }

  for (var ri = 0; ri < openRequests.length; ri++) {
    var req = openRequests[ri];
    var requestId = req.id;
    var escalationKey = "wa_approval_pending:" + requestId;

    var alreadyEscalated = false;
    try {
      var storeRaw = $app.store().get(escalationKey);
      if (storeRaw) {
        var storeEntry = JSON.parse(storeRaw);
        if (storeEntry && storeEntry.escalated === true) alreadyEscalated = true;
      }
    } catch (_) {}

    if (alreadyEscalated) {
      alreadyEscalatedCount++;
      continue;
    }

    var shortId = requestId.slice(-6);

    // Build the escalation message (same as cron)
    var requesterName = "Unknown";
    try {
      var requesterId = req.getString("requester");
      if (requesterId) {
        var requester = $app.dao().findRecordById("users", requesterId);
        requesterName = requester.getString("name") || requester.getString("email") || "Unknown";
      }
    } catch (_) {}

    var kitSerial = "N/A";
    try {
      var kitId = req.getString("designated_kit");
      if (kitId) {
        var kit = $app.dao().findRecordById("kits", kitId);
        kitSerial = kit.getString("serial") || "N/A";
      }
    } catch (_) {}

    var ageHours = Math.round(thresholdHours);
    var msgText =
      "⚠️ Request awaiting action for >" + ageHours + "h\n" +
      "Kit: " + kitSerial + "\n" +
      "Requested by: " + requesterName + "\n\n" +
      "Reply with:\n" +
      "- 'approve " + shortId + "' to approve\n" +
      "- 'reject " + shortId + "' to reject";

    // Apply pref gates per admin; track eligible counts for WA + TG
    var eligibleWa = 0;
    var tgActuallySent = 0;

    for (var ai = 0; ai < admins.length; ai++) {
      var admin = admins[ai];

      // ── WA pref gate (count eligible — route is dry-run; eligible = simulated 2xx) ──
      var waPrefAllowed = true;
      try {
        var prefRaw = admin.getString("notification_prefs") || "";
        if (prefRaw && prefRaw.trim()) {
          var prefs = JSON.parse(prefRaw);
          var channels = Array.isArray(prefs && prefs.channels) ? prefs.channels : ["whatsapp", "email"];
          var chanOk = false;
          for (var ci = 0; ci < channels.length; ci++) {
            if (channels[ci] === "whatsapp") { chanOk = true; break; }
          }
          if (!chanOk) {
            waPrefAllowed = false;
          } else {
            var events = (prefs && prefs.events) ? prefs.events : {};
            if (typeof events["request_escalation"] === "boolean") {
              waPrefAllowed = events["request_escalation"];
            }
          }
        }
      } catch (_) { waPrefAllowed = true; }
      if (waPrefAllowed && admin.getString("phone")) {
        eligibleWa++;
        try {
          var waAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
          var waAuditRec = new Record(waAuditCol);
          waAuditRec.set("collection_name", "messages");
          waAuditRec.set("record_id", "test-dryrun");
          waAuditRec.set("actor", admin.id);
          waAuditRec.set("action", "send_whatsapp");
          waAuditRec.set("changes", JSON.stringify({
            to: admin.getString("phone"),
            event: "request_escalation",
            request_id: requestId,
            short_id: shortId,
            dryrun: true
          }));
          $app.dao().saveRecord(waAuditRec);
        } catch (waAuditErr) {
          console.log("[wa_escalation/_test] WA audit write failed for admin " + admin.id + ":", waAuditErr);
        }
      }

      // ── TG pref gate + send ──
      var tgChannelOk = false;
      var tgEventOk = true;
      try {
        var tgPrefRaw = admin.getString("notification_prefs") || "";
        if (tgPrefRaw && tgPrefRaw.trim()) {
          var tgPrefs = JSON.parse(tgPrefRaw);
          var tgChannels = Array.isArray(tgPrefs && tgPrefs.channels) ? tgPrefs.channels : ["whatsapp", "email"];
          for (var tci = 0; tci < tgChannels.length; tci++) {
            if (tgChannels[tci] === "telegram") { tgChannelOk = true; break; }
          }
          if (tgChannelOk) {
            var tgEvents = (tgPrefs && tgPrefs.events) ? tgPrefs.events : {};
            if (typeof tgEvents["request_escalation"] === "boolean") {
              tgEventOk = tgEvents["request_escalation"];
            }
          }
        }
      } catch (_) {}

      if (tgChannelOk && tgEventOk) {
        var tgChatId = admin.getString("telegram_chat_id");
        if (tgChatId) {
          var tgOutcome = inlineSendTelegram(tgChatId, msgText);
          // Only count as a real delivery on actual "sent" — skipped_no_token / failed must not
          // suppress WA retry next tick (Fix 2 — retry-semantics correctness).
          if (tgOutcome === "sent") tgActuallySent++;
          // Audit — best-effort; written even for skipped_no_token so branch is observable in tests
          try {
            var tgAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
            var tgAuditRec = new Record(tgAuditCol);
            tgAuditRec.set("collection_name", "messages");
            tgAuditRec.set("record_id", tgChatId);
            tgAuditRec.set("actor", admin.id);
            tgAuditRec.set("action", "send_telegram");
            tgAuditRec.set("changes", JSON.stringify({
              to: tgChatId,
              event: "request_escalation",
              request_id: requestId,
              short_id: shortId,
              outcome: tgOutcome,
              chars: msgText.length
            }));
            $app.dao().saveRecord(tgAuditRec);
            tgSentCount++;
          } catch (tgAuditErr) {
            console.log("[tg_escalation/_test] audit_log write failed:", tgAuditErr);
          }
        }
      }
    }

    if (eligibleWa > 0 || tgActuallySent > 0) {
      try {
        $app.store().set(escalationKey, JSON.stringify({
          escalated: true,
          escalated_at: now.toISOString(),
          request_id: requestId,
          expires: now.getTime() + 24 * 60 * 60 * 1000
        }));
        escalatedCount++;
      } catch (_) {}
    }
  }

  return c.json(200, {
    fired: true,
    open_requests: openRequests.length,
    admin_phones: adminCount,
    escalated: escalatedCount,
    already_escalated: alreadyEscalatedCount,
    tg_sent: tgSentCount
  });
});
