/// <reference path="../pb_data/types.d.ts" />
// POST /api/wa/broadcast — Admin-initiated WhatsApp broadcast to N recipients.
//
// Body (JSON):
//   {
//     "recipientFilter": {
//       "type": "role" | "phones",
//       "value": "admin" | "technician" | "user" | "viewer" | ["972527799932", ...]
//     },
//     "message": {
//       "type": "text" | "template",
//       "text": "free-form text",
//       "template": { "name": "hello_world", "language": "en_US" }
//     }
//   }
//
// "type=entity" is not supported — return 400 (no clear entity→phone mapping).
//
// Auth: admin role only.
//
// Rate limit note: WhatsApp Cloud API supports ~80 msg/sec per phone number.
// Sends are serialized (not parallel) for safety to avoid burst rate violations.
//
// Environment (Fly secrets):
//   WHATSAPP_PHONE_NUMBER_ID — Meta phone number ID
//   WHATSAPP_TOKEN           — Bearer token for Graph API
//
// NO module-level vars — PB v0.22 Goja isolation.

routerAdd("POST", "/api/wa/broadcast", function(c) {

  // ===========================================================================
  // Auth gate — admin only
  // ===========================================================================
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  // ===========================================================================
  // Read env at call time (no module-level vars — Goja isolation)
  // ===========================================================================
  var phoneId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var token   = $os.getenv("WHATSAPP_TOKEN")           || "";

  if (!phoneId || !token) {
    console.log("[wa_broadcast] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN not set");
    return c.json(500, { error: "WhatsApp credentials not configured" });
  }

  // ===========================================================================
  // Parse request body
  // ===========================================================================
  // c.bind(non-pointer map) throws in PB v0.22 Goja; use info.data (already parsed above).
  var input = info.data || {};

  var recipientFilter = input.recipientFilter || null;
  var message         = input.message || null;

  if (!recipientFilter || !recipientFilter.type) {
    return c.json(400, { error: "recipientFilter.type is required" });
  }
  if (!message || !message.type) {
    return c.json(400, { error: "message.type is required" });
  }

  var filterType = recipientFilter.type;
  if (filterType !== "role" && filterType !== "phones") {
    return c.json(400, { error: "recipientFilter.type must be 'role' or 'phones' ('entity' not supported)" });
  }

  var msgType = message.type;
  if (msgType !== "text" && msgType !== "template") {
    return c.json(400, { error: "message.type must be 'text' or 'template'" });
  }

  var msgText     = (message.text || "").toString().trim();
  var msgTemplate = message.template || null;

  if (msgType === "text" && !msgText) {
    return c.json(400, { error: "message.text is required when type=text" });
  }
  if (msgType === "template" && (!msgTemplate || !msgTemplate.name)) {
    return c.json(400, { error: "message.template.name is required when type=template" });
  }

  // ===========================================================================
  // Resolve recipient phone numbers
  // ===========================================================================
  var phones = [];

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
        "role = {:role} && phone != ''",
        "-created",
        0,
        500,
        { role: role }
      );
    } catch (e) {
      console.log("[wa_broadcast] users query error: " + e);
      return c.json(500, { error: "failed to query users: " + String(e) });
    }

    for (var i = 0; i < userRecords.length; i++) {
      var phone = (userRecords[i].getString("phone") || "").trim();
      if (phone) {
        phones.push(phone);
      }
    }

  } else {
    // type=phones — use provided list directly
    var rawPhones = recipientFilter.value;
    if (!rawPhones || !Array.isArray(rawPhones)) {
      return c.json(400, { error: "recipientFilter.value must be an array of phone strings for type=phones" });
    }
    for (var j = 0; j < rawPhones.length; j++) {
      var p = (rawPhones[j] || "").toString().trim();
      if (p) {
        phones.push(p);
      }
    }
  }

  if (phones.length === 0) {
    return c.json(200, {
      totalRecipients: 0,
      successCount: 0,
      failed: [],
      message: "No recipients found with valid phone numbers"
    });
  }

  // ===========================================================================
  // Send to each recipient (serialized — not parallel, see rate limit note)
  // ===========================================================================
  var successCount = 0;
  var failed = [];

  for (var k = 0; k < phones.length; k++) {
    var toPhone = phones[k];

    var metaPayload;
    if (msgType === "text") {
      metaPayload = {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: msgText }
      };
    } else {
      metaPayload = {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "template",
        template: {
          name: msgTemplate.name,
          language: { code: msgTemplate.language || "en_US" }
        }
      };
    }

    var metaRes;
    var sendSuccess = false;
    var sendError = "";
    var wamid = "";

    try {
      metaRes = $http.send({
        url: "https://graph.facebook.com/v18.0/" + phoneId + "/messages",
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(metaPayload),
        timeout: 15000
      });

      if (metaRes.statusCode >= 200 && metaRes.statusCode < 300) {
        sendSuccess = true;
        try {
          var parsedBody = JSON.parse(metaRes.raw);
          if (parsedBody && parsedBody.messages && parsedBody.messages[0]) {
            wamid = parsedBody.messages[0].id || "";
          }
        } catch (_) {}
        console.log("[wa_broadcast] sent to=" + toPhone + " mode=" + msgType + " status=" + metaRes.statusCode);
      } else {
        sendError = "Meta API status " + metaRes.statusCode + ": " + metaRes.raw;
        console.log("[wa_broadcast] Meta API error to=" + toPhone + " status=" + metaRes.statusCode + " body=" + metaRes.raw);
      }
    } catch (e) {
      sendError = "HTTP error: " + String(e);
      console.log("[wa_broadcast] Meta API HTTP error to=" + toPhone + ": " + e);
    }

    if (sendSuccess) {
      successCount++;
    } else {
      failed.push({ phone: toPhone, error: sendError });
    }

    // Write audit_log entry per send
    try {
      var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
      var auditRec = new Record(auditCol);
      auditRec.set("actor", info.authRecord.id);
      auditRec.set("action", "send_whatsapp");
      auditRec.set("collection_name", "messages");
      auditRec.set("record_id", wamid || toPhone);
      var changesObj = {
        to: toPhone,
        mode: msgType,
        success: sendSuccess,
        via: "broadcast",
        filterType: filterType
      };
      if (msgType === "text") {
        changesObj.textPreview = msgText.length > 80 ? msgText.substring(0, 80) + "..." : msgText;
      } else if (msgTemplate && msgTemplate.name) {
        changesObj.templateName = msgTemplate.name;
      }
      if (!sendSuccess) {
        changesObj.error = sendError;
      }
      auditRec.set("changes", JSON.stringify(changesObj));
      $app.dao().saveRecord(auditRec);
    } catch (auditErr) {
      console.log("[wa_broadcast] audit_log write error for to=" + toPhone + ": " + auditErr);
      // Non-fatal
    }
  }

  // ===========================================================================
  // Return summary
  // ===========================================================================
  console.log("[wa_broadcast] done total=" + phones.length + " success=" + successCount + " failed=" + failed.length);

  return c.json(200, {
    totalRecipients: phones.length,
    successCount: successCount,
    failed: failed
  });
});
