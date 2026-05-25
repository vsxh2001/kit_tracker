/// <reference path="../pb_data/types.d.ts" />
// POST /api/wa/send — Admin-initiated outbound WhatsApp message via Meta Cloud API.
//
// Body (JSON):
//   { "to": "972527799932", "text": "free-form message" }
//   { "to": "972527799932", "template": { "name": "hello_world", "language": "en_US" } }
//
// Either "text" or "template" is required, not both.
// Auth: admin role only.
//
// Environment (Fly secrets):
//   WHATSAPP_PHONE_NUMBER_ID — Meta phone number ID
//   WHATSAPP_TOKEN           — Bearer token for Graph API
//
// NO module-level vars — PB v0.22 Goja isolation.

routerAdd("POST", "/api/wa/send", function(c) {

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
    console.log("[wa_send] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN not set");
    return c.json(500, { error: "WhatsApp credentials not configured" });
  }

  // ===========================================================================
  // Parse request body
  // ===========================================================================
  // c.bind(non-pointer map) throws in PB v0.22 Goja; use requestInfo.data instead.
  var input = ($apis.requestInfo(c).data) || {};

  var to       = (input.to       || "").toString().trim();
  var text     = (input.text     || "").toString().trim();
  var template = input.template || null;

  if (!to) {
    return c.json(400, { error: "to is required" });
  }

  var hasText     = text.length > 0;
  var hasTemplate = template && template.name;

  if (!hasText && !hasTemplate) {
    return c.json(400, { error: "either text or template is required" });
  }
  if (hasText && hasTemplate) {
    return c.json(400, { error: "provide either text or template, not both" });
  }

  // ===========================================================================
  // Build Meta Graph API payload
  // ===========================================================================
  var metaPayload;
  var textMode = hasText;

  if (textMode) {
    metaPayload = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    };
  } else {
    metaPayload = {
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language || "en_US" }
      }
    };
  }

  // ===========================================================================
  // Call Meta Graph API
  // ===========================================================================
  var metaRes;
  var success = false;
  var metaResponseBody = {};

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
      success = true;
      try { metaResponseBody = JSON.parse(metaRes.raw); } catch (_) {}
      console.log("[wa_send] sent to=" + to + " mode=" + (textMode ? "text" : "template") + " status=" + metaRes.statusCode);
    } else {
      console.log("[wa_send] Meta API error status=" + metaRes.statusCode + " body=" + metaRes.raw);
      try { metaResponseBody = JSON.parse(metaRes.raw); } catch (_) {}
    }
  } catch (e) {
    console.log("[wa_send] Meta API HTTP error: " + e);
    return c.json(502, { error: "failed to reach Meta API: " + String(e) });
  }

  // ===========================================================================
  // Write to audit_log
  // ===========================================================================
  var wamid = "";
  try {
    if (metaResponseBody && metaResponseBody.messages && metaResponseBody.messages[0]) {
      wamid = metaResponseBody.messages[0].id || "";
    }
  } catch (_) {}

  try {
    var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
    var auditRec = new Record(auditCol);
    auditRec.set("actor", info.authRecord.id);
    auditRec.set("action", "send_whatsapp");
    auditRec.set("collection_name", "messages");
    auditRec.set("record_id", wamid || to);
    var changesObj = { to: to, mode: textMode ? "text" : "template", success: success };
    if (!textMode && template && template.name) {
      changesObj.templateName = template.name;
    }
    auditRec.set("changes", JSON.stringify(changesObj));
    $app.dao().saveRecord(auditRec);
    console.log("[wa_send] audit_log written actor=" + info.authRecord.id + " to=" + to);
  } catch (auditErr) {
    console.log("[wa_send] audit_log write error: " + auditErr);
    // Non-fatal — don't fail the send because of audit failure
  }

  // ===========================================================================
  // Return Meta's response
  // ===========================================================================
  if (!success) {
    return c.json(metaRes.statusCode >= 400 ? metaRes.statusCode : 502, metaResponseBody);
  }

  return c.json(200, metaResponseBody);
});
