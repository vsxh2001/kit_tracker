/// <reference path="../pb_data/types.d.ts" />
// Tier 4: Smart escalation — WhatsApp approval requests unanswered for >1h.
//
// Every 5 minutes, scans open requests created more than WA_APPROVAL_ESCALATION_HOURS ago
// (default 1h). For each such request that has not yet been escalated (tracked in
// $app.store() with key "wa_approval_pending:<request_id>"), sends a WhatsApp message
// to ALL admins with a phone number (bypassing on-call routing).
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

cronAdd("wa_approval_escalation", "*/5 * * * *", function() {
  try {
    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
    if (!phoneNumberId || !waToken) {
      // Skip silently if WA env vars missing
      return;
    }

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
        0,
        200,
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

    // 2. Fetch all admins with phone (bypassing on-call routing for escalation)
    var admins = [];
    try {
      admins = $app.dao().findRecordsByFilter(
        "users",
        "role = 'admin' && phone != \"\"",
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
      console.log("[wa_escalation] no admins with phone — nothing to escalate to");
      return;
    }

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

        // Notification pref gate — request_escalation defaults to true
        var prefAllowed = true;
        try {
          var prefRaw = admin.getString("notification_prefs") || "";
          if (prefRaw && prefRaw.trim()) {
            var prefs = JSON.parse(prefRaw);
            // channels check
            var channels = Array.isArray(prefs && prefs.channels) ? prefs.channels : ["whatsapp", "email"];
            var chanOk = false;
            for (var ci = 0; ci < channels.length; ci++) {
              if (channels[ci] === "whatsapp") { chanOk = true; break; }
            }
            if (!chanOk) {
              prefAllowed = false;
            } else {
              // event check
              var events = (prefs && prefs.events) ? prefs.events : {};
              if (typeof events["request_escalation"] === "boolean") {
                prefAllowed = events["request_escalation"];
              }
            }
          }
        } catch (_) {
          prefAllowed = true;
        }

        if (!prefAllowed) {
          console.log("[wa_escalation] request_escalation skipped by prefs for admin " + admin.id);
          continue;
        }

        var adminPhone = admin.getString("phone") || "";
        if (!adminPhone) continue;

        var toPhone = adminPhone;
        if (toPhone.indexOf("whatsapp:") === 0) toPhone = toPhone.substring("whatsapp:".length);

        var payload = JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "text",
          text: { body: msgText }
        });

        var success = false;
        var wamid = "failed";

        try {
          var res = $http.send({
            method: "POST",
            url: apiUrl,
            body: payload,
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + waToken
            },
            timeout: 10000
          });

          if (res.statusCode >= 200 && res.statusCode < 300) {
            success = true;
            try {
              var parsed = JSON.parse(res.raw);
              if (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) {
                wamid = parsed.messages[0].id;
              }
            } catch (_) {}
            sentToAtLeastOne = true;
            console.log("[wa_escalation] escalation sent to admin " + admin.id + " phone=" + toPhone + " request=" + requestId + " wamid=" + wamid);
          } else {
            console.log("[wa_escalation] Meta API " + res.statusCode + " for admin " + admin.id + ": " + res.raw);
          }
        } catch (httpErr) {
          console.log("[wa_escalation] HTTP error for admin " + admin.id + ":", httpErr);
        }

        // Audit log — best-effort per admin
        try {
          var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
          var auditRec = new Record(auditCol);
          auditRec.set("collection_name", "messages");
          auditRec.set("record_id", wamid);
          auditRec.set("action", "send_whatsapp");
          auditRec.set("changes", JSON.stringify({
            to: toPhone,
            event: "request_escalation",
            request_id: requestId,
            short_id: shortId,
            success: success
          }));
          $app.dao().saveRecord(auditRec);
        } catch (auditErr) {
          console.log("[wa_escalation] audit_log write failed for admin " + admin.id + ":", auditErr);
        }
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
// Query params:
//   threshold_hours=<float>  (default 0 — all open requests qualify)
//
// Returns:
//   { skipped: "no_wa_creds" | "no_pending_requests" }
//   { fired: true, open_requests, admin_phones, escalated, already_escalated }
// ---------------------------------------------------------------------------
routerAdd("POST", "/_test/wa-approval-escalation", function(c) {
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
  if (!phoneNumberId || !waToken) {
    return c.json(200, { skipped: "no_wa_creds", escalated: 0, open_requests: 0 });
  }

  var thresholdHours = parseFloat(c.queryParam("threshold_hours") || "0");
  if (isNaN(thresholdHours) || thresholdHours < 0) thresholdHours = 0;
  var thresholdMs = thresholdHours * 60 * 60 * 1000;

  var now = new Date();
  var cutoff = new Date(now.getTime() - thresholdMs);
  var cutoffStr = cutoff.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  var openRequests = [];
  try {
    openRequests = $app.dao().findRecordsByFilter(
      "requests",
      "status = 'open' && created <= {:cutoff}",
      "-created", 0, 200,
      { cutoff: cutoffStr }
    );
  } catch (e) {
    return c.json(500, { error: "requests fetch error: " + String(e) });
  }

  if (!openRequests || openRequests.length === 0) {
    return c.json(200, { fired: true, skipped: "no_pending_requests", open_requests: 0, admin_phones: 0, escalated: 0, already_escalated: 0 });
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter(
      "users", "role = 'admin' && phone != \"\"",
      "", 100, 0, {}
    );
  } catch (e) {
    return c.json(500, { error: "admins fetch error: " + String(e) });
  }

  var adminCount = admins ? admins.length : 0;
  if (adminCount === 0) {
    return c.json(200, { fired: true, open_requests: openRequests.length, admin_phones: 0, escalated: 0, already_escalated: 0 });
  }

  var escalatedCount = 0;
  var alreadyEscalatedCount = 0;

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

    // Apply pref gate: count eligible admins
    var eligibleAdmins = 0;
    for (var ai = 0; ai < admins.length; ai++) {
      var admin = admins[ai];
      var prefAllowed = true;
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
            prefAllowed = false;
          } else {
            var events = (prefs && prefs.events) ? prefs.events : {};
            if (typeof events["request_escalation"] === "boolean") {
              prefAllowed = events["request_escalation"];
            }
          }
        }
      } catch (_) { prefAllowed = true; }
      if (prefAllowed) eligibleAdmins++;
    }

    if (eligibleAdmins > 0) {
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
    already_escalated: alreadyEscalatedCount
  });
});
