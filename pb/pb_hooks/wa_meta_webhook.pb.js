/// <reference path="../pb_data/types.d.ts" />
// GET  /api/wa/meta/webhook — Meta Cloud API webhook verification handshake.
// POST /api/wa/meta/webhook — Meta Cloud API inbound message receiver (Phase 1).
//
// Phase 1: side-by-side with Twilio (wa_inbound.pb.js). No Twilio changes.
// Phase 4 will deprecate Twilio once Meta path is stable.
//
// Environment (Fly secrets):
//   WHATSAPP_VERIFY_TOKEN    — random string for webhook verification handshake
//   WHATSAPP_PHONE_NUMBER_ID — Meta phone number ID (e.g. 1059995567204667)
//   WHATSAPP_TOKEN           — Bearer token for Graph API outbound calls
//
// $app.store() keys:
//   wa_meta_seen:<wamid>   — JSON { expires: <ms> }  24h TTL, idempotency
//   wa_meta_pending:<phone>— JSON { messageText, expiresAtMs }  30s confirm TTL
//   wa_meta_rate:<phone>   — JSON { count, windowStartMs }  1h / 30 msg rate cap
//
// All logic inlined per PB v0.22 Goja runtime isolation (no cross-file scope).
// NO module-level vars.

// =============================================================================
// GET — Meta webhook verification
// =============================================================================
routerAdd("GET", "/api/wa/meta/webhook", function(c) {
  var mode      = c.queryParam("hub.mode")         || "";
  var token     = c.queryParam("hub.verify_token") || "";
  var challenge = c.queryParam("hub.challenge")    || "";

  var expected = $os.getenv("WHATSAPP_VERIFY_TOKEN") || "";

  if (!expected) {
    console.log("[wa_meta] WHATSAPP_VERIFY_TOKEN not set — rejecting verification");
    return c.string(403, "Forbidden");
  }

  if (mode === "subscribe" && token === expected) {
    console.log("[wa_meta] webhook verification OK — echoing challenge");
    return c.string(200, challenge);
  }

  console.log("[wa_meta] webhook verification FAILED — mode=" + mode + " token_match=" + (token === expected));
  return c.string(403, "Forbidden");
});

// =============================================================================
// POST — inbound message
// =============================================================================
routerAdd("POST", "/api/wa/meta/webhook", function(c) {

  // ===========================================================================
  // INLINE HELPERS (inside callback — Goja isolation)
  // ===========================================================================

  // --- WA-friendly text formatting ---
  function formatForWA(text) {
    var lines = text.split("\n");
    var out = [];
    var inCodeBlock = false;
    var codeLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("```") === 0 || line.match(/^```/)) {
        if (inCodeBlock) {
          if (codeLines.length > 0) out.push("> " + codeLines.join(" | "));
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) { codeLines.push(line); continue; }
      line = line.replace(/^#{1,6}\s+/, "");
      line = line.replace(/\*\*([^*]+)\*\*/g, "*$1*");
      line = line.replace(/__([^_]+)__/g, "*$1*");
      out.push(line);
    }
    if (inCodeBlock && codeLines.length > 0) out.push("> " + codeLines.join(" | "));
    return out.join("\n");
  }

  // --- Split text into chunks <= 1500 chars, prefer paragraph breaks ---
  function splitChunks(text) {
    var MAX = 1500;
    if (text.length <= MAX) return [text];
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
          if (sp > 0) { breakAt = sp + 1; }
          else { breakAt = MAX; }
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());
    return chunks;
  }

  // --- Send single message via Meta Graph API ---
  function sendViaMeta(phoneNumberId, waToken, toPhone, text) {
    if (!phoneNumberId || !waToken) {
      console.log("[wa_meta] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN not set — cannot send outbound");
      return;
    }
    var url = "https://graph.facebook.com/v18.0/" + phoneNumberId + "/messages";
    try {
      var res = $http.send({
        method: "POST",
        url: url,
        headers: {
          "Authorization": "Bearer " + waToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone,
          type: "text",
          text: { body: text }
        }),
        timeout: 10000
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.log("[wa_meta] Graph API send failed " + res.statusCode + ": " + res.raw);
      } else {
        console.log("[wa_meta] sent msg to " + toPhone);
      }
    } catch (e) {
      console.log("[wa_meta] Graph API HTTP error: " + e);
    }
  }

  // --- Send multi-chunk reply (with (N/M) suffix if multi-part) ---
  function replyViaMeta(phoneNumberId, waToken, toPhone, text) {
    var formatted = formatForWA(text);
    var chunks = splitChunks(formatted);
    var total = chunks.length;
    for (var i = 0; i < chunks.length; i++) {
      var msg = total > 1 ? chunks[i] + "\n(" + (i + 1) + "/" + total + ")" : chunks[i];
      sendViaMeta(phoneNumberId, waToken, toPhone, msg);
      console.log("[wa_meta] sent reply chunk " + (i + 1) + "/" + total + " to " + toPhone);
    }
    return c.string(200, "");
  }

  // Write tool detection set (must match CLAUDE.md list)
  var WRITE_TOOLS = {
    create_entity: true, create_kit: true, move_kit: true,
    create_product: true, create_component: true, move_component: true,
    decide_request: true, link_component_to_product: true,
    update_entity: true, update_kit: true, update_product: true
  };

  function detectWriteTool(parsed) {
    if (!parsed) return null;
    var toolsUsed = parsed.toolsUsed || parsed.tools_used || parsed.toolsCalled || [];
    if (!Array.isArray(toolsUsed)) return null;
    for (var i = 0; i < toolsUsed.length; i++) {
      if (WRITE_TOOLS[toolsUsed[i]]) return toolsUsed[i];
    }
    if (parsed.confirmation_required === true) return "write";
    return null;
  }

  function isWriteAuthorized(userRec) {
    try {
      var r = userRec && userRec.get && userRec.get("role");
      return r === "admin" || r === "technician";
    } catch (_) { return false; }
  }

  // ===========================================================================
  // Read env at call time (no module-level vars — Goja isolation)
  // ===========================================================================
  var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var waToken       = $os.getenv("WHATSAPP_TOKEN")           || "";

  // ===========================================================================
  // Parse Meta JSON payload
  // ===========================================================================
  var payload = null;
  try {
    var info = $apis.requestInfo(c);
    payload = info && info.data ? info.data : null;
  } catch (e) {
    console.log("[wa_meta] requestInfo error: " + e);
    // Return 200 — Meta must not retry on parse errors we can't fix
    return c.string(200, "");
  }

  // Validate this is a whatsapp_business_account event
  if (!payload || payload.object !== "whatsapp_business_account") {
    console.log("[wa_meta] unexpected object type: " + (payload && payload.object));
    return c.string(200, "");
  }

  // Extract first message (Meta sends one message per webhook event in practice)
  var entry   = payload.entry   && payload.entry[0];
  var change  = entry && entry.changes && entry.changes[0];
  var value   = change && change.value;

  if (!value || change.field !== "messages") {
    // Status updates, delivery receipts, etc. — ack and ignore
    console.log("[wa_meta] non-message event (field=" + (change && change.field) + ") — acking");
    return c.string(200, "");
  }

  var messages = value.messages;
  if (!messages || messages.length === 0) {
    // Could be a status-update event — ack
    return c.string(200, "");
  }

  var msg  = messages[0];
  var from = msg.from  || "";   // E.164 phone, no "whatsapp:" prefix from Meta
  var wamid = msg.id   || "";   // Message ID for idempotency
  var msgType = msg.type || "";

  // Only handle text messages for now
  if (msgType !== "text" || !msg.text || !msg.text.body) {
    console.log("[wa_meta] non-text message type=" + msgType + " from=" + from + " — acking");
    return c.string(200, "");
  }

  var body = msg.text.body || "";
  console.log("[wa_meta] inbound from=" + from + " wamid=" + wamid + " body=" + body.slice(0, 80));

  if (!from || !body) {
    console.log("[wa_meta] missing from or body — acking");
    return c.string(200, "");
  }

  // ===========================================================================
  // Idempotency — dedupe by wamid (Meta retries on non-200)
  // ===========================================================================
  if (wamid) {
    var seenKey = "wa_meta_seen:" + wamid;
    var ttlMs   = 24 * 60 * 60 * 1000; // 24h
    var now     = Date.now();
    var existingRaw = null;
    try { existingRaw = $app.store().get(seenKey); } catch (_) {}
    if (existingRaw) {
      var existingEntry = null;
      try { existingEntry = JSON.parse(existingRaw); } catch (_) {}
      if (existingEntry && existingEntry.expires > now) {
        console.log("[wa_meta] duplicate wamid " + wamid + " — skipping");
        return c.string(200, "");
      }
    }
    try { $app.store().set(seenKey, JSON.stringify({ expires: now + ttlMs })); } catch (_) {}
  }

  // phone is already E.164 from Meta (no "whatsapp:" prefix)
  var phone = from;

  // ===========================================================================
  // Rate limit — max 30 messages per phone per hour (silent 200 on excess)
  // ===========================================================================
  var RATE_WINDOW_MS = 3600000;
  var RATE_MAX = 30;
  var rateKey = "wa_meta_rate:" + phone;
  var rateRaw = null;
  try { rateRaw = $app.store().get(rateKey); } catch (_) {}
  var rateEntry = { count: 0, windowStartMs: Date.now() };
  if (rateRaw) {
    try {
      var rp = JSON.parse(rateRaw);
      if (rp && rp.windowStartMs && (Date.now() - rp.windowStartMs) <= RATE_WINDOW_MS) {
        rateEntry = rp;
      }
    } catch (_) {}
  }
  rateEntry.count = (rateEntry.count || 0) + 1;
  if (rateEntry.count > RATE_MAX) {
    console.log("[wa_meta] rate limit hit for " + phone + " (" + rateEntry.count + " msgs in window)");
    try { $app.store().set(rateKey, JSON.stringify(rateEntry)); } catch (_) {}
    return c.string(200, "");
  }
  try { $app.store().set(rateKey, JSON.stringify(rateEntry)); } catch (_) {}

  // ===========================================================================
  // Look up user by phone
  // ===========================================================================
  var user = null;
  try {
    // Meta sends bare E.164 (e.g. "972527799932"). Strip any non-digits as defense.
    var inboundDigits = phone.replace(/\D/g, "");
    // last 9 digits — local number portion (handles +972 vs 0 prefix variants)
    var inboundLast9 = inboundDigits.slice(-9);

    // Fetch all users with phone set; iterate + normalize for comparison
    var allWithPhone = $app.dao().findRecordsByFilter(
      "users",
      "phone != \"\"",
      "",
      200,
      0,
      {}
    );

    for (var i = 0; i < allWithPhone.length; i++) {
      var storedRaw = allWithPhone[i].getString("phone") || "";
      var storedDigits = storedRaw.replace(/\D/g, "");
      if (!storedDigits) continue;
      // Match if full digits match, OR last-9 match (handles country-code variants)
      if (storedDigits === inboundDigits || storedDigits.slice(-9) === inboundLast9) {
        user = allWithPhone[i];
        break;
      }
    }
  } catch (e) {
    console.log("[wa_meta] user lookup error: " + e);
  }

  if (!user) {
    console.log("[wa_meta] no user found for phone=" + phone);
    return replyViaMeta(phoneNumberId, waToken, phone, "Unknown number. Ask an admin to add your phone to your user profile.");
  }

  var role = user.getString("role");
  if (!role || role === "denied") {
    console.log("[wa_meta] user " + user.id + " role=" + role + " — rejected");
    return replyViaMeta(phoneNumberId, waToken, phone, "Your account isn't approved for WhatsApp access yet.");
  }

  try { c.set("audit_via", "wa-meta-bot"); } catch (_) {}

  // ===========================================================================
  // Confirmation flow
  // ===========================================================================
  var pendingKey  = "wa_meta_pending:" + phone;
  var bodyTrimmed = body.trim();

  var pendingRaw = null;
  try { pendingRaw = $app.store().get(pendingKey); } catch (_) {}

  var pending = null;
  if (pendingRaw) {
    try {
      var p = JSON.parse(pendingRaw);
      if (p && p.expiresAtMs && Date.now() < p.expiresAtMs) {
        pending = p;
      } else {
        try { $app.store().remove(pendingKey); } catch (_) {}
        console.log("[wa_meta] pending confirmation expired for " + phone);
      }
    } catch (_) {
      try { $app.store().remove(pendingKey); } catch (_2) {}
    }
  }

  if (pending) {
    if (bodyTrimmed.toLowerCase() === "yes") {
      // Confirmed — check for direct-exec shortcut
      if (pending.directExec) {
        if (!isWriteAuthorized(user)) {
          try { $app.store().remove(pendingKey); } catch (_) {}
          console.log("[wa_meta] directExec refused — role=" + (user && user.get ? user.get("role") : "unknown"));
          return replyViaMeta(phoneNumberId, waToken, phone, "Permission lost — only admins or technicians can move kits.");
        }
        console.log("[wa_meta] YES received — direct-exec: " + JSON.stringify(pending.directExec));
        try { $app.store().remove(pendingKey); } catch (_) {}

        var deTool = pending.directExec.tool;
        var deArgs = pending.directExec.args;
        if (deTool !== "move_kit") {
          return replyViaMeta(phoneNumberId, waToken, phone, "Unknown direct-exec tool: " + deTool);
        }

        var kitRecs;
        try {
          kitRecs = $app.dao().findRecordsByFilter("kits", "serial = {:s} && is_active = true", "", 5, 0, { s: deArgs.kit_serial });
        } catch (e) {
          console.log("[wa_meta] direct-exec kit lookup error: " + e);
          return replyViaMeta(phoneNumberId, waToken, phone, "Internal error resolving kit. Try again.");
        }
        if (!kitRecs || kitRecs.length === 0) {
          return replyViaMeta(phoneNumberId, waToken, phone, "Kit '" + deArgs.kit_serial + "' not found or inactive.");
        }
        if (kitRecs.length > 1) {
          return replyViaMeta(phoneNumberId, waToken, phone, "Multiple active kits with serial '" + deArgs.kit_serial + "'. Resolve manually.");
        }
        var kitRec = kitRecs[0];

        var lastTxs;
        try {
          lastTxs = $app.dao().findRecordsByFilter("transactions", "kit = {:k}", "-timestamp,-created", 1, 0, { k: kitRec.id });
        } catch (_) {
          lastTxs = [];
        }
        var fromEntityId = (lastTxs && lastTxs.length > 0) ? lastTxs[0].get("to_entity") : "";

        try {
          var txCol = $app.dao().findCollectionByNameOrId("transactions");
          var txRec = new Record(txCol, {
            kit: kitRec.id,
            from_entity: fromEntityId,
            to_entity: deArgs.to_entity_id,
            timestamp: new Date().toISOString(),
            notes: "RETURN via WhatsApp (Meta)",
            created_by: user.id
          });
          $app.dao().saveRecord(txRec);

          // Explicit audit_log row ($app.dao().saveRecord() bypasses PB hooks)
          try {
            var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
            var auditRec = new Record(auditCol);
            auditRec.set("collection_name", "transactions");
            auditRec.set("record_id", txRec.id);
            auditRec.set("actor", user.id);
            auditRec.set("action", "create");
            auditRec.set("changes", JSON.stringify({
              via: "wa-meta-bot",
              tool: "move_kit",
              original_prompt: "return " + deArgs.kit_serial
            }));
            $app.dao().saveRecord(auditRec);
            console.log("[wa_meta] audit_log written for tx=" + txRec.id);
          } catch (auditErr) {
            console.log("[wa_meta] audit_log write error: " + auditErr);
          }
        } catch (e) {
          console.log("[wa_meta] direct-exec saveRecord error: " + e);
          return replyViaMeta(phoneNumberId, waToken, phone, "Failed to record return: " + String(e && e.message ? e.message : e));
        }
        return replyViaMeta(phoneNumberId, waToken, phone, "Done — " + deArgs.kit_serial + " returned to warehouse.");
      }

      // Confirmed — re-send original message to /api/ai/chat
      console.log("[wa_meta] YES received — re-executing: " + pending.messageText.slice(0, 80));
      try { $app.store().remove(pendingKey); } catch (_) {}

      var token2 = "";
      try {
        token2 = $tokens.recordAuthToken($app, user);
      } catch (e) {
        console.log("[wa_meta] token mint error: " + e);
        return replyViaMeta(phoneNumberId, waToken, phone, "Internal error (auth). Try again.");
      }

      var aiRes2;
      try {
        var confirmedMsg = "CONFIRM AND EXECUTE: " + pending.messageText;
        aiRes2 = $http.send({
          method: "POST",
          url: "http://127.0.0.1:8090/api/ai/chat",
          body: JSON.stringify({ message: confirmedMsg, sessionId: "wa-meta:" + user.id }),
          headers: {
            "Content-Type": "application/json",
            "Authorization": token2
          },
          timeout: 30000
        });
      } catch (e) {
        console.log("[wa_meta] /api/ai/chat HTTP error (confirm): " + e);
        return replyViaMeta(phoneNumberId, waToken, phone, "Internal error talking to AI. Try again.");
      }

      var reply2 = "(no reply)";
      if (aiRes2 && aiRes2.statusCode === 200) {
        try {
          var parsed2 = JSON.parse(aiRes2.raw);
          if (parsed2 && parsed2.reply) reply2 = String(parsed2.reply);
        } catch (_) {}
      } else if (aiRes2) {
        console.log("[wa_meta] /api/ai/chat returned " + aiRes2.statusCode + " (confirm)");
        reply2 = "AI error (" + aiRes2.statusCode + "). Try again.";
      }
      return replyViaMeta(phoneNumberId, waToken, phone, reply2);

    } else {
      // Not YES — cancel pending and fall through to normal processing
      console.log("[wa_meta] pending confirmation cancelled for " + phone);
      try { $app.store().remove(pendingKey); } catch (_) {}
    }
  }

  // ===========================================================================
  // Pre-flight RETURN shortcut — bypass AI, resolve serial directly
  // Matches: "return X", "send back X", "X is back"
  // ===========================================================================
  var returnMatch = body.trim().match(/^(?:return|send\s+back)\s+(\S+)\s*$/i)
                 || body.trim().match(/^(\S+)\s+is\s+back\s*$/i);
  if (returnMatch) {
    if (!isWriteAuthorized(user)) {
      console.log("[wa_meta] RETURN refused — role=" + (user && user.get ? user.get("role") : "unknown"));
      return replyViaMeta(phoneNumberId, waToken, phone, "Only admins or technicians can move kits via WhatsApp.");
    }
    var serial = returnMatch[1];
    var warehouseId = $os.getenv("DEFAULT_WAREHOUSE_ENTITY_ID") || "";
    if (!warehouseId) {
      console.log("[wa_meta] RETURN shortcut hit but DEFAULT_WAREHOUSE_ENTITY_ID unset");
      return replyViaMeta(phoneNumberId, waToken, phone, "Server has no default warehouse configured. Use full command: move " + serial + " to <warehouse>");
    }
    var warehouseRec = null;
    try {
      warehouseRec = $app.dao().findRecordById("entities", warehouseId);
    } catch (e) {
      console.log("[wa_meta] RETURN warehouse lookup failed: " + e);
    }
    if (!warehouseRec || warehouseRec.get("is_active") === false) {
      return replyViaMeta(phoneNumberId, waToken, phone, "Configured warehouse entity not found or inactive. Contact admin.");
    }
    var pendingEntryReturn = JSON.stringify({
      directExec: {
        tool: "move_kit",
        args: { kit_serial: serial, to_entity_id: warehouseId }
      },
      messageText: "return " + serial,
      expiresAtMs: Date.now() + 30000
    });
    try { $app.store().set(pendingKey, pendingEntryReturn); } catch (e) {
      console.log("[wa_meta] failed to set pending store (RETURN): " + e);
    }
    console.log("[wa_meta] RETURN intent detected — sending confirmation for serial=" + serial);
    return replyViaMeta(phoneNumberId, waToken, phone,
      "Confirm: return " + serial + " to warehouse (" + warehouseRec.get("name") + ")?\n\nReply YES within 30s to execute, or anything else to cancel.");
  }

  // ===========================================================================
  // Approve / Reject intent — admin WhatsApp approval workflow
  // Matches: "approve <id6>" / "reject <id6>" (6–15 alphanumeric chars)
  // ===========================================================================
  var approvalMatch = bodyTrimmed.match(/^(approve|reject)\s+([a-z0-9]{6,15})$/i);
  if (approvalMatch) {
    var apVerb = approvalMatch[1].toLowerCase();   // "approve" or "reject"
    var apShortId = approvalMatch[2].toLowerCase();

    // Must be admin
    var apRole = user.getString("role");
    if (apRole !== "admin") {
      console.log("[wa_meta] approve/reject refused — role=" + apRole);
      return replyViaMeta(phoneNumberId, waToken, phone, "Only admins can approve or reject requests via WhatsApp.");
    }

    // Resolve full request id from $app.store() map
    var apRequestId = null;
    try {
      var apStoreKey = "wa_approval_map:" + apShortId;
      var apStoreRaw = $app.store().get(apStoreKey);
      if (apStoreRaw) {
        var apStoreEntry = JSON.parse(apStoreRaw);
        if (apStoreEntry && apStoreEntry.requestId && apStoreEntry.expires > Date.now()) {
          apRequestId = apStoreEntry.requestId;
        }
      }
    } catch (_) {}

    // Fallback: query requests where id ends with shortId
    if (!apRequestId) {
      try {
        var apResults = $app.dao().findRecordsByFilter(
          "requests",
          $app.dao().db().newQuery ? "id LIKE {:suffix}" : "id LIKE {:suffix}",
          "",
          5,
          0,
          { suffix: "%" + apShortId }
        );
        if (apResults && apResults.length === 1) {
          apRequestId = apResults[0].id;
        } else if (apResults && apResults.length > 1) {
          return replyViaMeta(phoneNumberId, waToken, phone, "Multiple requests match '" + apShortId + "'. Use a longer ID.");
        }
      } catch (apLookupErr) {
        console.log("[wa_meta] approve/reject fallback lookup error:", apLookupErr);
      }
    }

    if (!apRequestId) {
      console.log("[wa_meta] approve/reject: request not found for short_id=" + apShortId);
      return replyViaMeta(phoneNumberId, waToken, phone, "Request '" + apShortId + "' not found or has expired (24h limit).");
    }

    // Load the request record
    var apRequest = null;
    try {
      apRequest = $app.dao().findRecordById("requests", apRequestId);
    } catch (apFindErr) {
      console.log("[wa_meta] approve/reject findRecordById error:", apFindErr);
      return replyViaMeta(phoneNumberId, waToken, phone, "Could not load request " + apShortId + ". Please try again.");
    }

    var apCurrentStatus = apRequest.getString("status");
    if (apCurrentStatus !== "open") {
      return replyViaMeta(phoneNumberId, waToken, phone, "Request " + apShortId + " is already " + apCurrentStatus + " — no action taken.");
    }

    var apNewStatus = apVerb === "approve" ? "approved" : "rejected";

    try {
      apRequest.set("status", apNewStatus);
      apRequest.set("decision_notes", "via WhatsApp");
      $app.dao().saveRecord(apRequest);
    } catch (apSaveErr) {
      console.log("[wa_meta] approve/reject saveRecord error:", apSaveErr);
      return replyViaMeta(phoneNumberId, waToken, phone, "Failed to " + apVerb + " request " + apShortId + ": " + String(apSaveErr && apSaveErr.message ? apSaveErr.message : apSaveErr));
    }

    // Audit log
    try {
      var apAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
      var apAuditRec = new Record(apAuditCol);
      apAuditRec.set("collection_name", "requests");
      apAuditRec.set("record_id", apRequestId);
      apAuditRec.set("actor", user.id);
      apAuditRec.set("action", apNewStatus);
      apAuditRec.set("changes", JSON.stringify({
        via: "whatsapp",
        short_id: apShortId,
        decision_notes: "via WhatsApp",
        from_status: apCurrentStatus,
        to_status: apNewStatus
      }));
      $app.dao().saveRecord(apAuditRec);
      console.log("[wa_meta] audit_log written for request=" + apRequestId + " action=" + apNewStatus);
    } catch (apAuditErr) {
      console.log("[wa_meta] audit_log write error (approve/reject):", apAuditErr);
    }

    var apEmoji = apVerb === "approve" ? "✅" : "❌";
    console.log("[wa_meta] request " + apRequestId + " " + apNewStatus + " via WhatsApp by admin " + user.id);
    return replyViaMeta(phoneNumberId, waToken, phone, apEmoji + " Request " + apShortId + " " + apNewStatus + ".");
  }

  // ===========================================================================
  // Pre-flight write-intent detection — confirm before calling AI
  // ===========================================================================
  var writeVerbs = /\b(move|create|add|new|make|delete|deactivate|remove|update|change|set|edit|approve|reject|fulfill|rename|reassign|transfer|put|send|cancel)\b/i;
  if (writeVerbs.test(body)) {
    if (!isWriteAuthorized(user)) {
      console.log("[wa_meta] write-verb blocked — role=" + (user && user.get ? user.get("role") : "unknown") + " is read-only");
      return replyViaMeta(phoneNumberId, waToken, phone, "You don't have permission to perform that action. Contact an admin.");
    }
    var pendingEntry0 = JSON.stringify({
      messageText: body,
      expiresAtMs: Date.now() + 30000
    });
    try { $app.store().set(pendingKey, pendingEntry0); } catch (e) {
      console.log("[wa_meta] failed to set pending store (pre-flight): " + e);
    }
    var confirmMsg0 = "Confirm: " + body.slice(0, 120) + "\n\nReply YES within 30s to execute, or anything else to cancel.";
    console.log("[wa_meta] write-intent detected pre-flight — sending confirmation");
    return replyViaMeta(phoneNumberId, waToken, phone, confirmMsg0);
  }

  // ===========================================================================
  // Normal flow — mint token + call /api/ai/chat
  // ===========================================================================
  var token = "";
  try {
    token = $tokens.recordAuthToken($app, user);
  } catch (e) {
    console.log("[wa_meta] token mint error: " + e);
    return replyViaMeta(phoneNumberId, waToken, phone, "Internal error (auth). Try again.");
  }

  var aiRes;
  try {
    aiRes = $http.send({
      method: "POST",
      url: "http://127.0.0.1:8090/api/ai/chat",
      body: JSON.stringify({ message: body, sessionId: "wa-meta:" + user.id }),
      headers: {
        "Content-Type": "application/json",
        "Authorization": token
      },
      timeout: 30000
    });
  } catch (e) {
    console.log("[wa_meta] /api/ai/chat HTTP error: " + e);
    return replyViaMeta(phoneNumberId, waToken, phone, "Internal error talking to AI. Try again.");
  }

  if (aiRes.statusCode !== 200) {
    console.log("[wa_meta] /api/ai/chat returned " + aiRes.statusCode + ": " + aiRes.raw);
    return replyViaMeta(phoneNumberId, waToken, phone, "AI error (" + aiRes.statusCode + "). Try again.");
  }

  var reply = "(no reply)";
  var parsedAi = null;
  try {
    parsedAi = JSON.parse(aiRes.raw);
    if (parsedAi && parsedAi.reply) reply = String(parsedAi.reply);
  } catch (_) {
    console.log("[wa_meta] reply parse error");
  }

  // Post-call write-tool check (defence-in-depth; pre-flight regex is primary guard)
  var writeTool = detectWriteTool(parsedAi);
  if (writeTool) {
    var pendingEntry = JSON.stringify({
      messageText: body,
      expiresAtMs: Date.now() + 30000
    });
    try { $app.store().set(pendingKey, pendingEntry); } catch (e) {
      console.log("[wa_meta] failed to set pending store: " + e);
    }
    var actionDesc = reply.replace(/\n/g, " ").slice(0, 120);
    var confirmMsg = "Confirm: " + actionDesc + "\n\nReply YES within 30s to proceed, or anything else to cancel.";
    console.log("[wa_meta] write-tool detected (" + writeTool + ") — sending confirmation prompt");
    return replyViaMeta(phoneNumberId, waToken, phone, confirmMsg);
  }

  return replyViaMeta(phoneNumberId, waToken, phone, reply);
});
