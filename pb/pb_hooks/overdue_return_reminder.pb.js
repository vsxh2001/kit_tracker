/// <reference path="../pb_data/types.d.ts" />
// Daily cron: email all admins about fulfilled requests past their expected_return date.
// Fires at 08:00 UTC. Silently skips if no overdue records or no SMTP configured.
//
// NOTE on PB v0.22 Goja scoping: routerAdd and cronAdd callbacks run in
// isolated Goja pool runtimes — they cannot reference functions declared at
// file scope. All logic is therefore inlined into each callback.

// ---------------------------------------------------------------------------
// Daily cron — 08:00 UTC.
// All logic inlined — cronAdd runs in an isolated Goja context.
// ---------------------------------------------------------------------------
cronAdd("overdueReturnReminder", "0 8 * * *", function() {
  console.log("[overdue-reminder] cron firing at", new Date().toISOString());

  function escHtml(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var nowDate = new Date().toISOString().slice(0, 10);

  var overdueRequests = [];
  try {
    overdueRequests = $app.dao().findRecordsByFilter(
      "requests",
      "status = 'fulfilled' && expected_return != '' && expected_return < {:today}",
      "-expected_return",
      100,
      0,
      { today: nowDate }
    );
  } catch (queryErr) {
    console.log("[overdue-reminder] cron: failed to query overdue requests:", queryErr);
    return;
  }

  if (overdueRequests.length === 0) {
    console.log("[overdue-reminder] cron: no overdue requests — nothing to send.");
    return;
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[overdue-reminder] cron: failed to query admins:", queryErr);
    return;
  }

  var nowISO = new Date().toISOString();
  var onCallShifts = [];
  try {
    onCallShifts = $app.dao().findRecordsByFilter(
      "on_call_shifts",
      "start_at <= {:now} && end_at >= {:now}",
      "",
      100,
      0,
      { now: nowISO }
    );
  } catch (e) {
    console.log("[overdue-reminder] cron: on-call lookup failed:", e);
  }

  var recipientsMap = {};
  for (var ri = 0; ri < admins.length; ri++) {
    recipientsMap[admins[ri].id] = admins[ri];
  }
  for (var oi = 0; oi < onCallShifts.length; oi++) {
    try {
      var ocUser = $app.dao().findRecordById("users", onCallShifts[oi].getString("user"));
      var ocRole = ocUser.getString("role");
      if (ocRole === "admin" || ocRole === "technician") {
        recipientsMap[ocUser.id] = ocUser;
      }
    } catch (e) { /* skip */ }
  }
  var recipientIds = Object.keys(recipientsMap);

  if (recipientIds.length === 0) {
    console.log("[overdue-reminder] cron: no recipients to notify.");
    return;
  }

  var rows = [];
  for (var ri2 = 0; ri2 < overdueRequests.length; ri2++) {
    var r = overdueRequests[ri2];
    var requesterEmail = "(unknown)";
    var kitSerial = "any";
    var entityName = "(unknown)";

    try {
      var requesterId = r.getString("requester");
      if (requesterId) {
        var requester = $app.dao().findRecordById("users", requesterId);
        requesterEmail = requester.getString("email") || requesterEmail;
      }
    } catch (_) {}

    try {
      var kitId = r.getString("designated_kit");
      if (kitId) {
        var kit = $app.dao().findRecordById("kits", kitId);
        kitSerial = kit.getString("serial") || kitSerial;
      }
    } catch (_) {}

    try {
      var entityId = r.getString("target_entity");
      if (entityId) {
        var entity = $app.dao().findRecordById("entities", entityId);
        entityName = entity.getString("name") || entityName;
      }
    } catch (_) {}

    var dueDate = r.getString("expected_return") || "";
    var baseUrlCron = $os.getenv("APP_BASE_URL") || "http://localhost:5173";
    var requestUrl = baseUrlCron + "/requests/" + r.id;

    rows.push(
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(kitSerial) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(entityName) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(requesterEmail) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(dueDate) + "</td>" +
      "<td style='padding:4px 12px 4px 0'><a href='" + escHtml(requestUrl) + "'>View</a></td>" +
      "</tr>"
    );
  }

  var htmlBody =
    "<h2>Overdue kit returns</h2>" +
    "<p>" + overdueRequests.length + " request(s) past their expected return date as of " + escHtml(nowDate) + ":</p>" +
    "<table style='border-collapse:collapse'>" +
    "<thead><tr>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Kit</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Entity</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Requester</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Due date</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Link</th>" +
    "</tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody>" +
    "</table>";

  var subject = "Kit Tracker: " + overdueRequests.length + " overdue return(s)";
  var senderAddress =
    ($app.settings().meta && $app.settings().meta.senderAddress) ||
    $os.getenv("SMTP_FROM") ||
    "notifications@kit.local";
  var senderName =
    ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  var sent = 0;
  for (var i = 0; i < recipientIds.length; i++) {
    var recipient = recipientsMap[recipientIds[i]];
    var recipientEmail2 = recipient.getString("email");
    var recipientName = recipient.getString("name") || recipientEmail2;
    if (!recipientEmail2) continue;

    try {
      var message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: recipientEmail2, name: recipientName }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[overdue-reminder] cron: notified:", recipientEmail2);
      sent++;
    } catch (mailErr) {
      var msg = String(mailErr);
      if (
        msg.indexOf("smtp") !== -1 ||
        msg.indexOf("SMTP") !== -1 ||
        msg.indexOf("dial") !== -1
      ) {
        console.log("[overdue-reminder] cron: SMTP not configured, skipping:", recipientEmail2);
      } else {
        console.log("[overdue-reminder] cron: failed to send to " + recipientEmail2 + ":", mailErr);
      }
    }
  }

  console.log("[overdue-reminder] cron: done — sent:", sent);
});

// ---------------------------------------------------------------------------
// Manual trigger route for testing (admin only).
// POST /_test/overdue-reminder
// All logic inlined — routerAdd callbacks run in isolated Goja contexts.
// ---------------------------------------------------------------------------
routerAdd("POST", "/_test/overdue-reminder", function(c) {
  var info = $apis.requestInfo(c);

  if (!info.admin) {
    var authRecord = info.authRecord;
    if (!authRecord || authRecord.getString("role") !== "admin") {
      throw new ForbiddenError("admin only");
    }
  }

  console.log("[overdue-reminder] manual trigger via /_test/overdue-reminder");

  function escHtml(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var nowDate = new Date().toISOString().slice(0, 10);

  var overdueRequests = [];
  try {
    overdueRequests = $app.dao().findRecordsByFilter(
      "requests",
      "status = 'fulfilled' && expected_return != '' && expected_return < {:today}",
      "-expected_return",
      100,
      0,
      { today: nowDate }
    );
  } catch (queryErr) {
    console.log("[overdue-reminder] route: failed to query overdue requests:", queryErr);
    return c.json(200, { fired: true, sent: 0, skipped: "query_error" });
  }

  if (overdueRequests.length === 0) {
    console.log("[overdue-reminder] route: no overdue requests — nothing to send.");
    return c.json(200, { fired: true, sent: 0, skipped: "no_overdue" });
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[overdue-reminder] route: failed to query admins:", queryErr);
    return c.json(200, { fired: true, sent: 0, skipped: "admin_query_error" });
  }

  var nowISO = new Date().toISOString();
  var onCallShifts = [];
  try {
    onCallShifts = $app.dao().findRecordsByFilter(
      "on_call_shifts",
      "start_at <= {:now} && end_at >= {:now}",
      "",
      100,
      0,
      { now: nowISO }
    );
  } catch (e) {
    console.log("[overdue-reminder] route: on-call lookup failed:", e);
  }

  var recipientsMap = {};
  for (var ri = 0; ri < admins.length; ri++) {
    recipientsMap[admins[ri].id] = admins[ri];
  }
  for (var oi = 0; oi < onCallShifts.length; oi++) {
    try {
      var ocUser = $app.dao().findRecordById("users", onCallShifts[oi].getString("user"));
      var ocRole = ocUser.getString("role");
      if (ocRole === "admin" || ocRole === "technician") {
        recipientsMap[ocUser.id] = ocUser;
      }
    } catch (e) { /* skip */ }
  }
  var recipientIds = Object.keys(recipientsMap);

  if (recipientIds.length === 0) {
    return c.json(200, { fired: true, sent: 0, skipped: "no_recipients" });
  }

  var rows = [];
  for (var ri2 = 0; ri2 < overdueRequests.length; ri2++) {
    var r = overdueRequests[ri2];
    var requesterEmail = "(unknown)";
    var kitSerial = "any";
    var entityName = "(unknown)";

    try {
      var requesterId2 = r.getString("requester");
      if (requesterId2) {
        var requester2 = $app.dao().findRecordById("users", requesterId2);
        requesterEmail = requester2.getString("email") || requesterEmail;
      }
    } catch (_) {}

    try {
      var kitId2 = r.getString("designated_kit");
      if (kitId2) {
        var kit2 = $app.dao().findRecordById("kits", kitId2);
        kitSerial = kit2.getString("serial") || kitSerial;
      }
    } catch (_) {}

    try {
      var entityId2 = r.getString("target_entity");
      if (entityId2) {
        var entity2 = $app.dao().findRecordById("entities", entityId2);
        entityName = entity2.getString("name") || entityName;
      }
    } catch (_) {}

    var dueDate = r.getString("expected_return") || "";
    var baseUrlRoute = $os.getenv("APP_BASE_URL") || "http://localhost:5173";
    var requestUrl = baseUrlRoute + "/requests/" + r.id;

    rows.push(
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(kitSerial) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(entityName) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(requesterEmail) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(dueDate) + "</td>" +
      "<td style='padding:4px 12px 4px 0'><a href='" + escHtml(requestUrl) + "'>View</a></td>" +
      "</tr>"
    );
  }

  var htmlBody =
    "<h2>Overdue kit returns</h2>" +
    "<p>" + overdueRequests.length + " request(s) past their expected return date as of " + escHtml(nowDate) + ":</p>" +
    "<table style='border-collapse:collapse'>" +
    "<thead><tr>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Kit</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Entity</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Requester</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Due date</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Link</th>" +
    "</tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody>" +
    "</table>";

  var subject = "Kit Tracker: " + overdueRequests.length + " overdue return(s)";
  var senderAddress =
    ($app.settings().meta && $app.settings().meta.senderAddress) ||
    $os.getenv("SMTP_FROM") ||
    "notifications@kit.local";
  var senderName =
    ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  var sent = 0;
  for (var i = 0; i < recipientIds.length; i++) {
    var recipient = recipientsMap[recipientIds[i]];
    var recipientEmail2 = recipient.getString("email");
    var recipientName = recipient.getString("name") || recipientEmail2;
    if (!recipientEmail2) continue;

    try {
      var message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: recipientEmail2, name: recipientName }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[overdue-reminder] route: notified:", recipientEmail2);
      sent++;
    } catch (mailErr) {
      var msg2 = String(mailErr);
      if (
        msg2.indexOf("smtp") !== -1 ||
        msg2.indexOf("SMTP") !== -1 ||
        msg2.indexOf("dial") !== -1
      ) {
        console.log("[overdue-reminder] route: SMTP not configured, skipping:", recipientEmail2);
      } else {
        console.log("[overdue-reminder] route: failed to send to " + recipientEmail2 + ":", mailErr);
      }
    }
  }

  return c.json(200, { fired: true, sent: sent, skipped: null });
});
