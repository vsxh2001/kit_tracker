/// <reference path="../pb_data/types.d.ts" />
// GET /api/wa/admin/status — Admin-only WhatsApp integration status endpoint.
//
// Returns phone number info, token debug data, webhook config, and WABA subscriptions.
//
// Auth: admin only.
//
// Environment (Fly secrets):
//   WHATSAPP_PHONE_NUMBER_ID — Meta phone number ID (e.g. 1059995567204667)
//   WHATSAPP_TOKEN           — Bearer token for Graph API
//   WHATSAPP_VERIFY_TOKEN    — Webhook verify token (checked for presence only)
//   WHATSAPP_WABA_ID         — WhatsApp Business Account ID (e.g. 1012217101334902)
//
// NO module-level vars — PB v0.22 Goja isolation.

routerAdd("GET", "/api/wa/admin/status", function(c) {

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
  var phoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var waToken       = $os.getenv("WHATSAPP_TOKEN")           || "";
  var verifyToken   = $os.getenv("WHATSAPP_VERIFY_TOKEN")    || "";
  var wabaId        = $os.getenv("WHATSAPP_WABA_ID")         || "";

  // ===========================================================================
  // Phone number info — GET graph.facebook.com/v18.0/{phoneNumberId}
  // ===========================================================================
  var phoneData = null;
  if (phoneNumberId && waToken) {
    try {
      var phoneRes = $http.send({
        method: "GET",
        url: "https://graph.facebook.com/v18.0/" + phoneNumberId + "?fields=display_phone_number,verified_name,quality_rating",
        headers: { "Authorization": "Bearer " + waToken },
        timeout: 10000
      });
      if (phoneRes.statusCode >= 200 && phoneRes.statusCode < 300) {
        try { phoneData = JSON.parse(phoneRes.raw); } catch (_) {}
      } else {
        console.log("[wa_status] phone number fetch failed " + phoneRes.statusCode + ": " + phoneRes.raw);
      }
    } catch (e) {
      console.log("[wa_status] phone number HTTP error: " + e);
    }
  }

  // ===========================================================================
  // Token debug — GET graph.facebook.com/debug_token
  // ===========================================================================
  var tokenData = null;
  if (waToken) {
    try {
      var tokenRes = $http.send({
        method: "GET",
        url: "https://graph.facebook.com/debug_token?input_token=" + waToken + "&access_token=" + waToken,
        headers: { "Authorization": "Bearer " + waToken },
        timeout: 10000
      });
      if (tokenRes.statusCode >= 200 && tokenRes.statusCode < 300) {
        var tokenRaw = null;
        try { tokenRaw = JSON.parse(tokenRes.raw); } catch (_) {}
        if (tokenRaw && tokenRaw.data) {
          var d = tokenRaw.data;
          var expiresAt = d.expires_at || 0;
          var daysRemaining = 0;
          if (expiresAt > 0) {
            var nowSec = Math.floor(Date.now() / 1000);
            var diffSec = expiresAt - nowSec;
            daysRemaining = diffSec > 0 ? Math.floor(diffSec / 86400) : 0;
          }
          tokenData = {
            type: d.type || "UNKNOWN",
            expires_at: expiresAt,
            days_remaining: daysRemaining,
            is_valid: d.is_valid === true,
            scopes: Array.isArray(d.scopes) ? d.scopes : []
          };
        }
      } else {
        console.log("[wa_status] token debug fetch failed " + tokenRes.statusCode + ": " + tokenRes.raw);
      }
    } catch (e) {
      console.log("[wa_status] token debug HTTP error: " + e);
    }
  }

  // ===========================================================================
  // Webhook config — from env + last inbound lookup in audit_log
  // ===========================================================================
  var lastInboundAt = null;
  try {
    // Look for most recent inbound event via audit_log action="wa_meta_inbound"
    // or action="send_whatsapp" written by the webhook handler
    var auditRows = $app.dao().findRecordsByFilter(
      "audit_log",
      "action = 'wa_meta_inbound' || action = 'send_whatsapp'",
      "-created",
      1,
      0,
      {}
    );
    if (auditRows && auditRows.length > 0) {
      lastInboundAt = auditRows[0].getString("created") || null;
    }
  } catch (e) {
    console.log("[wa_status] audit_log lookup error: " + e);
  }

  var webhookData = {
    url: "https://kit-tracker.fly.dev/api/wa/meta/webhook",
    verify_token_set: verifyToken.length > 0,
    last_inbound_at: lastInboundAt
  };

  // ===========================================================================
  // Subscribed apps — GET graph.facebook.com/v18.0/{wabaId}/subscribed_apps
  // ===========================================================================
  var wabaData = null;
  if (wabaId && waToken) {
    var subscribedApps = [];
    try {
      var appsRes = $http.send({
        method: "GET",
        url: "https://graph.facebook.com/v18.0/" + wabaId + "/subscribed_apps",
        headers: { "Authorization": "Bearer " + waToken },
        timeout: 10000
      });
      if (appsRes.statusCode >= 200 && appsRes.statusCode < 300) {
        var appsRaw = null;
        try { appsRaw = JSON.parse(appsRes.raw); } catch (_) {}
        if (appsRaw && Array.isArray(appsRaw.data)) {
          subscribedApps = appsRaw.data;
        }
      } else {
        console.log("[wa_status] subscribed apps fetch failed " + appsRes.statusCode + ": " + appsRes.raw);
      }
    } catch (e) {
      console.log("[wa_status] subscribed apps HTTP error: " + e);
    }
    wabaData = {
      id: wabaId,
      subscribed_apps: subscribedApps
    };
  }

  // ===========================================================================
  // Build response
  // ===========================================================================
  var result = {
    phoneNumber: phoneData ? {
      display: phoneData.display_phone_number || "",
      verified_name: phoneData.verified_name || "",
      quality_rating: phoneData.quality_rating || "UNKNOWN",
      id: phoneData.id || phoneNumberId
    } : null,
    token: tokenData,
    webhook: webhookData,
    waba: wabaData
  };

  return c.json(200, result);
});
