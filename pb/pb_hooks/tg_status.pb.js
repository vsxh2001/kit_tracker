/// <reference path="../pb_data/types.d.ts" />
// GET /api/tg/admin/status — Admin-only Telegram integration status endpoint.
//
// Returns bot info, webhook config, and linked user count.
//
// Auth: admin only.
//
// Environment (Fly secrets):
//   TELEGRAM_BOT_TOKEN      — BotFather token (e.g. 123456789:AAF...)
//
// NO module-level vars — PB v0.22 Goja isolation.

routerAdd("GET", "/api/tg/admin/status", function(c) {

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
  var botToken     = $os.getenv("TELEGRAM_BOT_TOKEN")      || "";

  // ===========================================================================
  // Not configured — skip silently
  // ===========================================================================
  if (!botToken) {
    return c.json(200, { configured: false });
  }

  var apiBase = "https://api.telegram.org/bot" + botToken;

  // ===========================================================================
  // getMe — bot identity
  // ===========================================================================
  var botData = null;
  try {
    var getMeRes = $http.send({
      method: "GET",
      url: apiBase + "/getMe",
      timeout: 10000
    });
    if (getMeRes.statusCode >= 200 && getMeRes.statusCode < 300) {
      try {
        var getMeRaw = JSON.parse(getMeRes.raw);
        if (getMeRaw && getMeRaw.ok && getMeRaw.result) {
          var r = getMeRaw.result;
          botData = {
            id: r.id,
            username: r.username || "",
            first_name: r.first_name || "",
            ok: true
          };
        }
      } catch (_) {}
    } else {
      console.log("[tg_status] getMe failed " + getMeRes.statusCode + ": " + getMeRes.raw);
    }
  } catch (e) {
    console.log("[tg_status] getMe HTTP error: " + e);
  }

  // ===========================================================================
  // getWebhookInfo — webhook configuration
  // ===========================================================================
  var webhookData = null;
  try {
    var webhookRes = $http.send({
      method: "GET",
      url: apiBase + "/getWebhookInfo",
      timeout: 10000
    });
    if (webhookRes.statusCode >= 200 && webhookRes.statusCode < 300) {
      try {
        var webhookRaw = JSON.parse(webhookRes.raw);
        if (webhookRaw && webhookRaw.ok && webhookRaw.result) {
          var w = webhookRaw.result;
          webhookData = {
            url: w.url || "",
            pending_update_count: w.pending_update_count || 0,
            last_error_date: w.last_error_date || null,
            last_error_message: w.last_error_message || null,
            has_custom_certificate: w.has_custom_certificate === true
          };
        }
      } catch (_) {}
    } else {
      console.log("[tg_status] getWebhookInfo failed " + webhookRes.statusCode + ": " + webhookRes.raw);
    }
  } catch (e) {
    console.log("[tg_status] getWebhookInfo HTTP error: " + e);
  }

  // ===========================================================================
  // Linked user count — users with telegram_chat_id set
  // Cap at 500; return count + whether capped.
  // ===========================================================================
  var linkedUsersCount = 0;
  try {
    var linkedRecords = $app.dao().findRecordsByFilter(
      "users",
      "telegram_chat_id != ''",
      "",
      500,
      0,
      {}
    );
    linkedUsersCount = linkedRecords ? linkedRecords.length : 0;
  } catch (e) {
    console.log("[tg_status] linked users count error: " + e);
  }

  // ===========================================================================
  // Build response
  // ===========================================================================
  return c.json(200, {
    configured: true,
    bot: botData,
    webhook: webhookData,
    linked_users_count: linkedUsersCount
  });
});
