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
// channel: "whatsapp" | "email"
// event: "request_fulfilled" | "kit_moved" | "maintenance_digest" | "overdue_return"
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Request fulfilled — approved → fulfilled transition notifies requester
// ---------------------------------------------------------------------------
onRecordAfterUpdateRequest(function(e) {
  // Must run in try/catch — failure must NOT block the update response.
  try {
    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var token = $os.getenv("WHATSAPP_TOKEN") || "";
    if (!phoneNumberId || !token) return; // no creds — skip silently

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

    // Notification pref gate
    if (!_waNotifAllowed(requester, "whatsapp", "request_fulfilled")) {
      console.log("[wa_auto_notify] request_fulfilled skipped by prefs for user", requesterId);
      return;
    }

    var recipientPhone = requester.getString("phone");
    if (!recipientPhone) return; // no phone — skip silently

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

    // Strip leading "whatsapp:" prefix if present (normalize)
    var toPhone = recipientPhone;
    if (toPhone.indexOf("whatsapp:") === 0) toPhone = toPhone.substring("whatsapp:".length);

    // POST to Meta Cloud API (free-form text — works within 24h reply window)
    var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";
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
          "Authorization": "Bearer " + token
        },
        timeout: 10000
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        success = true;
        // Extract wamid from response
        try {
          var parsed = JSON.parse(res.raw);
          if (parsed && parsed.messages && parsed.messages[0] && parsed.messages[0].id) {
            wamid = parsed.messages[0].id;
          }
        } catch (_) {}
        console.log("[wa_auto_notify] request_fulfilled sent to " + toPhone + " wamid=" + wamid);
      } else {
        console.log("[wa_auto_notify] request_fulfilled Meta API " + res.statusCode + ": " + res.raw);
        // 4xx "outside window" or template error — swallow per spec
      }
    } catch (httpErr) {
      console.log("[wa_auto_notify] request_fulfilled HTTP error:", httpErr);
    }

    // Audit log — best-effort
    try {
      var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
      var auditRec = new Record(auditCol);
      auditRec.set("collection_name", "messages");
      auditRec.set("record_id", wamid);
      auditRec.set("action", "send_whatsapp");
      auditRec.set("changes", JSON.stringify({
        to: toPhone,
        event: "request_fulfilled",
        success: success
      }));
      $app.dao().saveRecord(auditRec);
    } catch (auditErr) {
      console.log("[wa_auto_notify] audit_log write failed:", auditErr);
    }

  } catch (outerErr) {
    console.log("[wa_auto_notify] onRecordAfterUpdateRequest(requests) error:", outerErr);
  }
}, "requests");

// ---------------------------------------------------------------------------
// Request created — notify all admins with phone for approval (WhatsApp)
// Each admin gets a short-id prompt: "approve <id6>" / "reject <id6>"
// $app.store() key: wa_approval_map:<short_id> → full request id (24h TTL)
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest(function(e) {
  try {
    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var token = $os.getenv("WHATSAPP_TOKEN") || "";
    if (!phoneNumberId || !token) return; // no creds — skip silently

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
          "role = 'admin' && phone != \"\" && id IN (" + quotedIds + ")",
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

    // Find all admins with phone set and request_pending pref not false
    var admins = [];
    try {
      var onCallAdmins = getCurrentOnCallAdmins();
      if (onCallAdmins) {
        console.log("[wa_auto_notify] request_pending: on-call routing to " + onCallAdmins.length + " admin(s)");
        admins = onCallAdmins;
      } else {
        admins = $app.dao().findRecordsByFilter(
          "users",
          "role = 'admin' && phone != \"\"",
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

    var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";

    for (var i = 0; i < admins.length; i++) {
      var admin = admins[i];

      // Pref gate — request_pending defaults to true
      if (!_waNotifAllowed(admin, "whatsapp", "request_pending")) {
        console.log("[wa_auto_notify] request_pending skipped by prefs for admin", admin.id);
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
            "Authorization": "Bearer " + token
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
          console.log("[wa_auto_notify] request_pending sent to admin " + admin.id + " phone=" + toPhone + " wamid=" + wamid);
        } else {
          console.log("[wa_auto_notify] request_pending Meta API " + res.statusCode + " for admin " + admin.id + ": " + res.raw);
        }
      } catch (httpErr) {
        console.log("[wa_auto_notify] request_pending HTTP error for admin " + admin.id + ":", httpErr);
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
          event: "request_pending",
          request_id: requestId,
          short_id: shortId,
          success: success
        }));
        $app.dao().saveRecord(auditRec);
      } catch (auditErr) {
        console.log("[wa_auto_notify] audit_log write failed (request_pending):", auditErr);
      }
    }

  } catch (outerErr) {
    console.log("[wa_auto_notify] onRecordAfterCreateRequest(requests) error:", outerErr);
  }
}, "requests");

// ---------------------------------------------------------------------------
// Transaction created — kit moved notification (OPT-IN via WHATSAPP_NOTIFY_MOVES=1)
// ---------------------------------------------------------------------------
onRecordAfterCreateRequest(function(e) {
  try {
    // Opt-in guard
    var notifyMoves = $os.getenv("WHATSAPP_NOTIFY_MOVES") || "";
    if (notifyMoves !== "1") return;

    var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
    var token = $os.getenv("WHATSAPP_TOKEN") || "";
    if (!phoneNumberId || !token) return;

    var record = e.record;
    var kitId = record.getString("kit");
    if (!kitId) return;

    // Check if this kit has an active approved/fulfilled request with a phone-equipped requester
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

    // Notification pref gate
    if (!_waNotifAllowed(requester, "whatsapp", "kit_moved")) {
      console.log("[wa_auto_notify] kit_moved skipped by prefs for user", requesterId);
      return;
    }

    var recipientPhone = requester.getString("phone");
    if (!recipientPhone) return;

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

    var toPhone = recipientPhone;
    if (toPhone.indexOf("whatsapp:") === 0) toPhone = toPhone.substring("whatsapp:".length);

    var apiUrl = "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";
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
          "Authorization": "Bearer " + token
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
        console.log("[wa_auto_notify] kit_moved sent to " + toPhone + " wamid=" + wamid);
      } else {
        console.log("[wa_auto_notify] kit_moved Meta API " + res.statusCode + ": " + res.raw);
      }
    } catch (httpErr) {
      console.log("[wa_auto_notify] kit_moved HTTP error:", httpErr);
    }

    // Audit log — best-effort
    try {
      var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
      var auditRec = new Record(auditCol);
      auditRec.set("collection_name", "messages");
      auditRec.set("record_id", wamid);
      auditRec.set("action", "send_whatsapp");
      auditRec.set("changes", JSON.stringify({
        to: toPhone,
        event: "kit_moved",
        success: success
      }));
      $app.dao().saveRecord(auditRec);
    } catch (auditErr) {
      console.log("[wa_auto_notify] audit_log write failed (kit_moved):", auditErr);
    }

  } catch (outerErr) {
    console.log("[wa_auto_notify] onRecordAfterCreateRequest(transactions) error:", outerErr);
  }
}, "transactions");
