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
    try {
      var kit = $app.dao().findRecordById("kits", s.getString("kit"));
      if (!kit || !kit.getBool("is_active")) continue;
      due.push({ schedule: s, kit: kit });
    } catch (e) {
      console.log("[maintenance-reminder] cron: kit lookup failed for schedule", s.id);
    }
  }
  if (due.length === 0) { console.log("[maintenance-reminder] cron: all matching schedules belong to retired kits."); return; }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[maintenance-reminder] cron: failed to query admins:", queryErr);
    return;
  }
  if (admins.length === 0) { console.log("[maintenance-reminder] cron: no admins."); return; }

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
      "<td style='padding:4px 12px 4px 0'><b>" + escMaint(item.kit.getString("serial")) + "</b></td>" +
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
    "<thead><tr><th style='padding:4px 12px 4px 0;text-align:left'>Status</th><th style='padding:4px 12px 4px 0;text-align:left'>Kit</th><th style='padding:4px 12px 4px 0;text-align:left'>Type</th><th style='padding:4px 12px 4px 0;text-align:left'>Due date</th><th style='padding:4px 12px 4px 0;text-align:left'>Description</th></tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table>";

  var subject = "Kit Tracker: " + due.length + " maintenance item(s) due";
  var senderAddress = ($app.settings().meta && $app.settings().meta.senderAddress) || $os.getenv("SMTP_FROM") || "notifications@kit.local";
  var senderName = ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  var sent = 0;
  for (var k = 0; k < admins.length; k++) {
    var admin = admins[k];
    var adminEmail = admin.getString("email");
    if (!adminEmail) continue;
    try {
      var message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: adminEmail, name: admin.getString("name") || adminEmail }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[maintenance-reminder] cron: notified admin:", adminEmail);
      sent++;
    } catch (mailErr) {
      var mailErrStr = String(mailErr);
      if (mailErrStr.indexOf("smtp") !== -1 || mailErrStr.indexOf("SMTP") !== -1 || mailErrStr.indexOf("dial") !== -1) {
        console.log("[maintenance-reminder] cron: SMTP not configured, skipping:", adminEmail);
      } else {
        console.log("[maintenance-reminder] cron: failed to send to " + adminEmail + ":", mailErr);
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
    try {
      var kit = $app.dao().findRecordById("kits", s.getString("kit"));
      if (!kit || !kit.getBool("is_active")) continue;
      due.push({ schedule: s, kit: kit });
    } catch (e) {
      console.log("[maintenance-reminder] route: kit lookup failed for schedule", s.id);
    }
  }

  if (due.length === 0) {
    return c.json(200, { fired: true, skipped: "retired_kits", due: 0, sent: 0 });
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[maintenance-reminder] route: failed to query admins:", queryErr);
    return c.json(200, { fired: true, skipped: "admin_query_error", due: due.length, sent: 0 });
  }

  if (admins.length === 0) {
    return c.json(200, { fired: true, skipped: "no_admins", due: due.length, sent: 0 });
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
      "<td style='padding:4px 12px 4px 0'><b>" + escMaint(item.kit.getString("serial")) + "</b></td>" +
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
    "<thead><tr><th style='padding:4px 12px 4px 0;text-align:left'>Status</th><th style='padding:4px 12px 4px 0;text-align:left'>Kit</th><th style='padding:4px 12px 4px 0;text-align:left'>Type</th><th style='padding:4px 12px 4px 0;text-align:left'>Due date</th><th style='padding:4px 12px 4px 0;text-align:left'>Description</th></tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table>";

  var subject = "Kit Tracker: " + due.length + " maintenance item(s) due";
  var senderAddress = ($app.settings().meta && $app.settings().meta.senderAddress) || $os.getenv("SMTP_FROM") || "notifications@kit.local";
  var senderName = ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  var sent = 0;
  for (var k = 0; k < admins.length; k++) {
    var admin = admins[k];
    var adminEmail = admin.getString("email");
    if (!adminEmail) continue;
    try {
      var message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: adminEmail, name: admin.getString("name") || adminEmail }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[maintenance-reminder] route: notified admin:", adminEmail);
      sent++;
    } catch (mailErr) {
      var mailErrStr = String(mailErr);
      if (mailErrStr.indexOf("smtp") !== -1 || mailErrStr.indexOf("SMTP") !== -1 || mailErrStr.indexOf("dial") !== -1) {
        console.log("[maintenance-reminder] route: SMTP not configured, skipping:", adminEmail);
      } else {
        console.log("[maintenance-reminder] route: failed to send to " + adminEmail + ":", mailErr);
      }
    }
  }

  console.log("[maintenance-reminder] route: done — due:", due.length, "sent:", sent);
  return c.json(200, { fired: true, skipped: null, due: due.length, sent: sent });
});
