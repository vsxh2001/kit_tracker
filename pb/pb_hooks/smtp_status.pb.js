/// <reference path="../pb_data/types.d.ts" />
// GET /api/health/smtp
//
// Admin-only endpoint. Returns whether SMTP is enabled in PB settings.
// Used by the frontend dashboard to surface a config warning banner.
//
// Returns: { enabled: boolean }
// 403 if caller is not admin.

routerAdd("GET", "/api/health/smtp", function(e) {
  var info = $apis.requestInfo(e);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    throw new ForbiddenError("admin only");
  }
  var settings = $app.settings();
  var enabled = settings.smtp && settings.smtp.enabled === true;
  return e.json(200, { enabled: enabled });
});
