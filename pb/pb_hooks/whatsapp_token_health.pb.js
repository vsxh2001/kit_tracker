/// <reference path="../pb_data/types.d.ts" />
// GET /api/health/whatsapp-token
//
// Admin-only endpoint. Validates the WHATSAPP_TOKEN env var against the
// Meta Graph API debug_token endpoint and returns expiry info.
// Used by the frontend dashboard to surface a token-expiry warning banner.
//
// Returns: { is_valid, expires_at?, days_remaining?, warning_level }
// warning_level: "ok" | "warn14" | "warn7" | "warn1" | "expired" | "never" | "missing"
// 403 if caller is not admin.

routerAdd("GET", "/api/health/whatsapp-token", function(e) {
  var auth = e.auth;
  if (!auth || auth.get("role") !== "admin") {
    throw new ForbiddenError("admin only");
  }

  var token = $os.getenv("WHATSAPP_TOKEN");
  if (!token) {
    return e.json(200, { is_valid: false, warning_level: "missing" });
  }

  var resp;
  try {
    resp = $http.send({
      method: "GET",
      url: "https://graph.facebook.com/debug_token?input_token=" + token + "&access_token=" + token,
      timeout: 10,
    });
  } catch (_err) {
    return e.json(200, { is_valid: false, warning_level: "expired" });
  }

  var body = resp.json();
  var data = body && body.data;

  if (!data || body.error) {
    return e.json(200, { is_valid: false, warning_level: "expired" });
  }

  if (!data.is_valid) {
    return e.json(200, { is_valid: false, warning_level: "expired" });
  }

  var expiresAt = data.expires_at;

  if (!expiresAt || expiresAt === 0) {
    return e.json(200, { is_valid: true, warning_level: "never" });
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var daysRemaining = Math.floor((expiresAt - nowSec) / 86400);

  var level;
  if (daysRemaining <= 0) {
    level = "expired";
  } else if (daysRemaining <= 1) {
    level = "warn1";
  } else if (daysRemaining <= 7) {
    level = "warn7";
  } else if (daysRemaining <= 14) {
    level = "warn14";
  } else {
    level = "ok";
  }

  return e.json(200, {
    is_valid: true,
    expires_at: expiresAt,
    days_remaining: daysRemaining,
    warning_level: level,
  });
});
