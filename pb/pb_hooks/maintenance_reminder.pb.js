/// <reference path="../pb_data/types.d.ts" />
// Daily 8am UTC: email all admins about maintenance schedules due in the next
// 7 days or already overdue.  Mirrors the overdue_return_reminder.pb.js pattern.
//
// NOTE on PB v0.22 Goja scoping: routerAdd and cronAdd callbacks run in
// isolated Goja pool runtimes — they cannot reference functions declared at
// file scope.  All logic is therefore inlined into each callback.

// ---------------------------------------------------------------------------
// Shared inline logic — duplicated inside cron + route callbacks.
// ---------------------------------------------------------------------------

// cronAdd callback — no closure over file-scope names
cronAdd("maintenanceReminder", "0 8 * * *", function() {
  console.log("[maintenance-reminder] cron firing at", new Date().toISOString());

  function escMaint(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var todayStr   = new Date().toISOString().slice(0, 10);
  var horizon    = new Date();
  horizon.setDate(horizon.getDate() + 7);
  var horizonStr = horizon.toISOString().slice(0, 10);

  var schedules = [];
  try {
    schedules = $app.dao().findRecordsByFilter(
      "kit_maintenance_schedules",
      "is_active = true && next_due_at <= {:horizon}",
      "next_due_at",
      100,
      0,
      { horizon: horizonStr }
    );
  } catch (queryErr) {
    console.log("[maintenance-reminder] cron: failed to query schedules:", queryErr);
    return;
  }

  if (schedules.length === 0) {
    console.log("[maintenance-reminder] cron: no due/overdue schedules.");
    return;
  }

  var due = [];
  for (var i = 0; i < schedules.length; i++) {
    var s = schedules[i];
    var kitId = s.getString("kit");
    var compId = s.getString("component");
    if (kitId) {
      try {
        var kit = $app.dao().findRecordById("kits", kitId);
        if (!kit || !kit.getBool("is_active")) continue;
        due.push({ schedule: s, target: kit.getString("serial") });
      } catch (e) {
        console.log("[maintenance-reminder] cron: kit lookup failed for schedule", s.id);
      }
    } else if (compId) {
      try {
        var comp = $app.dao().findRecordById("components", compId);
        if (!comp) continue;
        due.push({ schedule: s, target: comp.getString("serial") + " (component)" });
      } catch (e) {
        console.log("[maintenance-reminder] cron: component lookup failed for schedule", s.id);
      }
    } else {
      console.log("[maintenance-reminder] cron: schedule has neither kit nor component, skipping", s.id);
    }
  }
  if (due.length === 0) { console.log("[maintenance-reminder] cron: all matching schedules belong to retired kits/components."); return; }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[maintenance-reminder] cron: failed to query admins:", queryErr);
    return;
  }

  var nowISOCron = new Date().toISOString();
  var onCallShiftsCron = [];
  try {
    onCallShiftsCron = $app.dao().findRecordsByFilter(
      "on_call_shifts",
      "start_at <= {:now} && end_at >= {:now}",
      "",
      100,
      0,
      { now: nowISOCron }
    );
  } catch (e) {
    console.log("[maintenance-reminder] cron: on-call lookup failed:", e);
  }

  var recipientsMapCron = {};
  for (var ri = 0; ri < admins.length; ri++) {
    recipientsMapCron[admins[ri].id] = admins[ri];
  }
  for (var oi = 0; oi < onCallShiftsCron.length; oi++) {
    try {
      var ocUser = $app.dao().findRecordById("users", onCallShiftsCron[oi].getString("user"));
      var ocRole = ocUser.getString("role");
      if (ocRole === "admin" || ocRole === "technician") {
        recipientsMapCron[ocUser.id] = ocUser;
      }
    } catch (e) { /* skip */ }
  }
  var recipientIdsCron = Object.keys(recipientsMapCron);
  if (recipientIdsCron.length === 0) { console.log("[maintenance-reminder] cron: no recipients."); return; }

  var rows = [];
  for (var j = 0; j < due.length; j++) {
    var item = due[j];
    var dueDate = item.schedule.getString("next_due_at");
    var overdue = dueDate < todayStr;
    var flag = overdue ? "<strong style='color:red'>OVERDUE</strong>" : "due soon";
    var desc = item.schedule.getString("description");
    rows.push(
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'>" + flag + "</td>" +
      "<td style='padding:4px 12px 4px 0'><b>" + escMaint(item.target) + "</b></td>" +
      "<td style='padding:4px 12px 4px 0'>" + escMaint(item.schedule.getString("type")) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escMaint(dueDate) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escMaint(desc) + "</td>" +
      "</tr>"
    );
  }

  var htmlBody =
    "<h2>Maintenance digest</h2>" +
    "<p>" + due.length + " schedule(s) due within 7 days or overdue as of " + escMaint(todayStr) + ":</p>" +
    "<table style='border-collapse:collapse'>" +
    "<thead><tr><th style='padding:4px 12px 4px 0;text-align:left'>Status</th><th style='padding:4px 12px 4px 0;text-align:left'>Kit / Component</th><th style='padding:4px 12px 4px 0;text-align:left'>Type</th><th style='padding:4px 12px 4px 0;text-align:left'>Due date</th><th style='padding:4px 12px 4px 0;text-align:left'>Description</th></tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table>";

  var subject = "Kit Tracker: " + due.length + " maintenance item(s) due";
  var senderAddress = ($app.settings().meta && $app.settings().meta.senderAddress) || $os.getenv("SMTP_FROM") || "notifications@kit.local";
  var senderName = ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  var sent = 0;
  for (var k = 0; k < recipientIdsCron.length; k++) {
    var recipient = recipientsMapCron[recipientIdsCron[k]];
    var recipientEmail = recipient.getString("email");
    if (!recipientEmail) continue;
    try {
      var message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: recipientEmail, name: recipient.getString("name") || recipientEmail }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[maintenance-reminder] cron: notified:", recipientEmail);
      sent++;
    } catch (mailErr) {
      var mailErrStr = String(mailErr);
      if (mailErrStr.indexOf("smtp") !== -1 || mailErrStr.indexOf("SMTP") !== -1 || mailErrStr.indexOf("dial") !== -1) {
        console.log("[maintenance-reminder] cron: SMTP not configured, skipping:", recipientEmail);
      } else {
        console.log("[maintenance-reminder] cron: failed to send to " + recipientEmail + ":", mailErr);
      }
    }
  }

  console.log("[maintenance-reminder] cron: done — due:", due.length, "sent:", sent);
});

// ---------------------------------------------------------------------------
// Manual trigger route for testing (admin only).
// POST /_test/maintenance-reminder
// All logic inlined — routerAdd callbacks run in isolated Goja contexts.
// ---------------------------------------------------------------------------
routerAdd("POST", "/_test/maintenance-reminder", function(c) {
  var info = $apis.requestInfo(c);
  if (!info.admin) {
    var authRecord = info.authRecord;
    if (!authRecord || authRecord.getString("role") !== "admin") {
      throw new ForbiddenError("admin only");
    }
  }

  console.log("[maintenance-reminder] manual trigger via /_test/maintenance-reminder");

  function escMaint(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var todayStr   = new Date().toISOString().slice(0, 10);
  var horizon    = new Date();
  horizon.setDate(horizon.getDate() + 7);
  var horizonStr = horizon.toISOString().slice(0, 10);

  var schedules = [];
  try {
    schedules = $app.dao().findRecordsByFilter(
      "kit_maintenance_schedules",
      "is_active = true && next_due_at <= {:horizon}",
      "next_due_at",
      100,
      0,
      { horizon: horizonStr }
    );
  } catch (queryErr) {
    console.log("[maintenance-reminder] route: failed to query schedules:", queryErr);
    return c.json(200, { fired: true, skipped: "query_error", due: 0, sent: 0 });
  }

  if (schedules.length === 0) {
    console.log("[maintenance-reminder] route: no due/overdue schedules.");
    return c.json(200, { fired: true, skipped: "no_due", due: 0, sent: 0 });
  }

  var due = [];
  for (var i = 0; i < schedules.length; i++) {
    var s = schedules[i];
    var kitId = s.getString("kit");
    var compId = s.getString("component");
    if (kitId) {
      try {
        var kit = $app.dao().findRecordById("kits", kitId);
        if (!kit || !kit.getBool("is_active")) continue;
        due.push({ schedule: s, target: kit.getString("serial") });
      } catch (e) {
        console.log("[maintenance-reminder] route: kit lookup failed for schedule", s.id);
      }
    } else if (compId) {
      try {
        var comp = $app.dao().findRecordById("components", compId);
        if (!comp) continue;
        due.push({ schedule: s, target: comp.getString("serial") + " (component)" });
      } catch (e) {
        console.log("[maintenance-reminder] route: component lookup failed for schedule", s.id);
      }
    } else {
      console.log("[maintenance-reminder] route: schedule has neither kit nor component, skipping", s.id);
    }
  }

  if (due.length === 0) {
    return c.json(200, { fired: true, skipped: "retired_kits_or_components", due: 0, sent: 0 });
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[maintenance-reminder] route: failed to query admins:", queryErr);
    return c.json(200, { fired: true, skipped: "admin_query_error", due: due.length, sent: 0 });
  }

  var nowISORoute = new Date().toISOString();
  var onCallShiftsRoute = [];
  try {
    onCallShiftsRoute = $app.dao().findRecordsByFilter(
      "on_call_shifts",
      "start_at <= {:now} && end_at >= {:now}",
      "",
      100,
      0,
      { now: nowISORoute }
    );
  } catch (e) {
    console.log("[maintenance-reminder] route: on-call lookup failed:", e);
  }

  var recipientsMapRoute = {};
  for (var ri = 0; ri < admins.length; ri++) {
    recipientsMapRoute[admins[ri].id] = admins[ri];
  }
  for (var oi = 0; oi < onCallShiftsRoute.length; oi++) {
    try {
      var ocUser = $app.dao().findRecordById("users", onCallShiftsRoute[oi].getString("user"));
      var ocRole = ocUser.getString("role");
      if (ocRole === "admin" || ocRole === "technician") {
        recipientsMapRoute[ocUser.id] = ocUser;
      }
    } catch (e) { /* skip */ }
  }
  var recipientIdsRoute = Object.keys(recipientsMapRoute);

  if (recipientIdsRoute.length === 0) {
    return c.json(200, { fired: true, skipped: "no_recipients", due: due.length, sent: 0 });
  }

  // Short-circuit when SMTP is not configured — surfaces a clear signal to admins
  // running the manual trigger rather than reporting sent=0 with no reason.
  var smtpEnabled = false;
  try {
    var smtpSettings = $app.settings().smtp;
    smtpEnabled = !!(smtpSettings && smtpSettings.enabled === true);
  } catch (e) { /* default false */ }
  if (!smtpEnabled) {
    console.log("[maintenance-reminder] route: SMTP not configured, would-send=" + recipientIdsRoute.length);
    return c.json(200, { fired: true, skipped: "smtp_unconfigured", due: due.length, sent: 0 });
  }

  var rows = [];
  for (var j = 0; j < due.length; j++) {
    var item = due[j];
    var dueDate = item.schedule.getString("next_due_at");
    var overdue = dueDate < todayStr;
    var flag = overdue ? "<strong style='color:red'>OVERDUE</strong>" : "due soon";
    var desc = item.schedule.getString("description");
    rows.push(
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'>" + flag + "</td>" +
      "<td style='padding:4px 12px 4px 0'><b>" + escMaint(item.target) + "</b></td>" +
      "<td style='padding:4px 12px 4px 0'>" + escMaint(item.schedule.getString("type")) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escMaint(dueDate) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escMaint(desc) + "</td>" +
      "</tr>"
    );
  }

  var htmlBody =
    "<h2>Maintenance digest</h2>" +
    "<p>" + due.length + " schedule(s) due within 7 days or overdue as of " + escMaint(todayStr) + ":</p>" +
    "<table style='border-collapse:collapse'>" +
    "<thead><tr><th style='padding:4px 12px 4px 0;text-align:left'>Status</th><th style='padding:4px 12px 4px 0;text-align:left'>Kit / Component</th><th style='padding:4px 12px 4px 0;text-align:left'>Type</th><th style='padding:4px 12px 4px 0;text-align:left'>Due date</th><th style='padding:4px 12px 4px 0;text-align:left'>Description</th></tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table>";

  var subject = "Kit Tracker: " + due.length + " maintenance item(s) due";
  var senderAddress = ($app.settings().meta && $app.settings().meta.senderAddress) || $os.getenv("SMTP_FROM") || "notifications@kit.local";
  var senderName = ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  var sent = 0;
  for (var k = 0; k < recipientIdsRoute.length; k++) {
    var recipient = recipientsMapRoute[recipientIdsRoute[k]];
    var recipientEmail = recipient.getString("email");
    if (!recipientEmail) continue;
    try {
      var message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: recipientEmail, name: recipient.getString("name") || recipientEmail }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[maintenance-reminder] route: notified:", recipientEmail);
      sent++;
    } catch (mailErr) {
      var mailErrStr = String(mailErr);
      if (mailErrStr.indexOf("smtp") !== -1 || mailErrStr.indexOf("SMTP") !== -1 || mailErrStr.indexOf("dial") !== -1) {
        console.log("[maintenance-reminder] route: SMTP not configured, skipping:", recipientEmail);
      } else {
        console.log("[maintenance-reminder] route: failed to send to " + recipientEmail + ":", mailErr);
      }
    }
  }

  console.log("[maintenance-reminder] route: done — due:", due.length, "sent:", sent);

  return c.json(200, { fired: true, skipped: null, due: due.length, sent: sent });
});
