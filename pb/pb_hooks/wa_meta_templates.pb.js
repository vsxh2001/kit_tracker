/// <reference path="../pb_data/types.d.ts" />
// GET  /api/wa/admin/templates — list Meta message templates (admin only)
// POST /api/wa/admin/templates — submit a new template to Meta (admin only, best-effort)
//
// Auth: admin only.
//
// Environment (Fly secrets):
//   WHATSAPP_TOKEN   — Bearer token for Graph API
//   WHATSAPP_WABA_ID — WhatsApp Business Account ID
//
// NO module-level vars — PB v0.22 Goja isolation.

routerAdd("GET", "/api/wa/admin/templates", function(c) {

  // Auth gate — admin only
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  // Read env at call time
  var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
  var wabaId  = $os.getenv("WHATSAPP_WABA_ID") || "";

  if (!waToken || !wabaId) {
    return c.json(200, { data: [], warning: "WHATSAPP_TOKEN or WHATSAPP_WABA_ID not configured" });
  }

  // Call Meta Graph API
  var templates = [];
  try {
    var res = $http.send({
      method: "GET",
      url: "https://graph.facebook.com/v18.0/" + wabaId + "/message_templates?fields=name,status,category,language,components&limit=100",
      headers: { "Authorization": "Bearer " + waToken },
      timeout: 15000
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      var parsed = null;
      try { parsed = JSON.parse(res.raw); } catch (_) {}
      if (parsed && Array.isArray(parsed.data)) {
        templates = parsed.data;
      }
    } else {
      console.log("[wa_templates] list fetch failed " + res.statusCode + ": " + res.raw);
      var errParsed = null;
      try { errParsed = JSON.parse(res.raw); } catch (_) {}
      return c.json(res.statusCode, {
        error: (errParsed && errParsed.error && errParsed.error.message) || ("Meta API error " + res.statusCode)
      });
    }
  } catch (e) {
    console.log("[wa_templates] list HTTP error: " + e);
    return c.json(502, { error: "Failed to reach Meta API: " + e });
  }

  return c.json(200, { data: templates });
});

routerAdd("POST", "/api/wa/admin/templates", function(c) {

  // Auth gate — admin only
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  // Read env at call time
  var waToken = $os.getenv("WHATSAPP_TOKEN") || "";
  var wabaId  = $os.getenv("WHATSAPP_WABA_ID") || "";

  if (!waToken || !wabaId) {
    return c.json(400, { error: "WHATSAPP_TOKEN or WHATSAPP_WABA_ID not configured" });
  }

  // Parse request body
  var body = null;
  try {
    var raw = readerToString(c.request().body);
    body = JSON.parse(raw);
  } catch (e) {
    return c.json(400, { error: "Invalid JSON body" });
  }

  if (!body || !body.name || !body.category || !body.language || !Array.isArray(body.components)) {
    return c.json(400, { error: "name, category, language, and components are required" });
  }

  // Call Meta Graph API
  var payload = JSON.stringify({
    name: body.name,
    category: body.category,
    language: body.language,
    components: body.components
  });

  try {
    var res = $http.send({
      method: "POST",
      url: "https://graph.facebook.com/v18.0/" + wabaId + "/message_templates",
      headers: {
        "Authorization": "Bearer " + waToken,
        "Content-Type": "application/json"
      },
      body: payload,
      timeout: 15000
    });

    var resParsed = null;
    try { resParsed = JSON.parse(res.raw); } catch (_) {}

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return c.json(200, { success: true, data: resParsed });
    } else {
      console.log("[wa_templates] submit failed " + res.statusCode + ": " + res.raw);
      var metaErr = (resParsed && resParsed.error && resParsed.error.message) || ("Meta API error " + res.statusCode);
      // Detect Test app permission error
      var isPermissionError = res.statusCode === 403 ||
        (resParsed && resParsed.error && (
          resParsed.error.code === 200 ||
          resParsed.error.code === 10 ||
          (resParsed.error.message && resParsed.error.message.indexOf("permission") !== -1)
        ));
      return c.json(200, {
        success: false,
        error: metaErr,
        isPermissionError: isPermissionError
      });
    }
  } catch (e) {
    console.log("[wa_templates] submit HTTP error: " + e);
    return c.json(200, { success: false, error: "Failed to reach Meta API: " + e });
  }
});
