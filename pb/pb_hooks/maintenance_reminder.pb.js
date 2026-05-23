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

  // -----------------------------------------------------------------------
  // WhatsApp digest (Meta Cloud API) — for each admin/technician with phone
  // Best-effort: failures log but never block.
  // -----------------------------------------------------------------------
  var waPhoneNumberId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var waToken = $os.getenv("WHATSAPP_TOKEN") || "";

  if (waPhoneNumberId && waToken) {
    // Build plain-text bullet list
    var waBullets = [];
    for (var wb = 0; wb < due.length; wb++) {
      var wItem = due[wb];
      var wDueDate = wItem.schedule.getString("next_due_at");
      var wType = wItem.schedule.getString("type") || "";
      waBullets.push("• " + wItem.target + ": " + wType + " due " + wDueDate);
    }
    var waMsgText = "Maintenance digest — " + due.length + " schedule(s) due:\n" + waBullets.join("\n");

    var waApiUrl = "https://graph.facebook.com/v19.0/" + waPhoneNumberId + "/messages";

    for (var wk = 0; wk < recipientIdsCron.length; wk++) {
      var waRecip = recipientsMapCron[recipientIdsCron[wk]];
      var waPhone = waRecip.getString("phone") || "";
      if (!waPhone) continue;

      // Notification pref gate — inline (cronAdd runs in isolated Goja runtime)
      var waPrefsRawCron = waRecip.getString("notification_prefs") || "";
      var waCronAllowed = true;
      if (waPrefsRawCron && waPrefsRawCron.trim()) {
        try {
          var waPrefsCron = JSON.parse(waPrefsRawCron);
          var waChansCron = (waPrefsCron && Array.isArray(waPrefsCron.channels)) ? waPrefsCron.channels : ["whatsapp", "email"];
          var waChanOkCron = false;
          for (var wcci = 0; wcci < waChansCron.length; wcci++) {
            if (waChansCron[wcci] === "whatsapp") { waChanOkCron = true; break; }
          }
          if (!waChanOkCron) {
            waCronAllowed = false;
          } else {
            var waEvsCron = (waPrefsCron && waPrefsCron.events) ? waPrefsCron.events : {};
            if (typeof waEvsCron["maintenance_digest"] === "boolean") waCronAllowed = waEvsCron["maintenance_digest"];
          }
        } catch (_) { /* malformed → opt-in */ }
      }
      if (!waCronAllowed) {
        console.log("[maintenance-reminder] cron: WA skipped by prefs for user", waRecip.id);
        continue;
      }

      // Normalize phone
      if (waPhone.indexOf("whatsapp:") === 0) waPhone = waPhone.substring("whatsapp:".length);

      var waPayload = JSON.stringify({
        messaging_product: "whatsapp",
        to: waPhone,
        type: "text",
        text: { body: waMsgText }
      });

      var waSuccess = false;
      var waWamid = "failed";

      try {
        var waRes = $http.send({
          method: "POST",
          url: waApiUrl,
          body: waPayload,
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + waToken
          },
          timeout: 10000
        });

        if (waRes.statusCode >= 200 && waRes.statusCode < 300) {
          waSuccess = true;
          try {
            var waParsed = JSON.parse(waRes.raw);
            if (waParsed && waParsed.messages && waParsed.messages[0] && waParsed.messages[0].id) {
              waWamid = waParsed.messages[0].id;
            }
          } catch (_) {}
          console.log("[maintenance-reminder] cron: WA sent to " + waPhone + " wamid=" + waWamid);
        } else {
          console.log("[maintenance-reminder] cron: WA Meta API " + waRes.statusCode + ": " + waRes.raw);
        }
      } catch (waHttpErr) {
        console.log("[maintenance-reminder] cron: WA HTTP error:", waHttpErr);
      }

      // Audit log — best-effort
      try {
        var waAuditCol = $app.dao().findCollectionByNameOrId("audit_log");
        var waAuditRec = new Record(waAuditCol);
        waAuditRec.set("collection_name", "messages");
        waAuditRec.set("record_id", waWamid);
        waAuditRec.set("action", "send_whatsapp");
        waAuditRec.set("changes", JSON.stringify({
          to: waPhone,
          event: "maintenance_digest",
          success: waSuccess
        }));
        $app.dao().saveRecord(waAuditRec);
      } catch (waAuditErr) {
        console.log("[maintenance-reminder] cron: audit_log WA write failed:", waAuditErr);
      }
    }
  } else {
    console.log("[maintenance-reminder] cron: WHATSAPP_PHONE_NUMBER_ID/TOKEN not set — skipping WA.");
  }
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

  // -----------------------------------------------------------------------
  // WhatsApp digest (Meta Cloud API) — for each admin/technician with phone
  // Best-effort: failures log but never block.
  // -----------------------------------------------------------------------
  var waPhoneNumberIdR = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var waTokenR = $os.getenv("WHATSAPP_TOKEN") || "";

  if (waPhoneNumberIdR && waTokenR) {
    var waBulletsR = [];
    for (var wbR = 0; wbR < due.length; wbR++) {
      var wItemR = due[wbR];
      var wDueDateR = wItemR.schedule.getString("next_due_at");
      var wTypeR = wItemR.schedule.getString("type") || "";
      waBulletsR.push("• " + wItemR.target + ": " + wTypeR + " due " + wDueDateR);
    }
    var waMsgTextR = "Maintenance digest — " + due.length + " schedule(s) due:\n" + waBulletsR.join("\n");

    var waApiUrlR = "https://graph.facebook.com/v19.0/" + waPhoneNumberIdR + "/messages";

    for (var wkR = 0; wkR < recipientIdsRoute.length; wkR++) {
      var waRecipR = recipientsMapRoute[recipientIdsRoute[wkR]];
      var waPhoneR = waRecipR.getString("phone") || "";
      if (!waPhoneR) continue;

      // Notification pref gate — inline (routerAdd runs in isolated Goja runtime)
      var waPrefsRawRoute = waRecipR.getString("notification_prefs") || "";
      var waRouteAllowed = true;
      if (waPrefsRawRoute && waPrefsRawRoute.trim()) {
        try {
          var waPrefsRoute = JSON.parse(waPrefsRawRoute);
          var waChansRoute = (waPrefsRoute && Array.isArray(waPrefsRoute.channels)) ? waPrefsRoute.channels : ["whatsapp", "email"];
          var waChanOkRoute = false;
          for (var wcri = 0; wcri < waChansRoute.length; wcri++) {
            if (waChansRoute[wcri] === "whatsapp") { waChanOkRoute = true; break; }
          }
          if (!waChanOkRoute) {
            waRouteAllowed = false;
          } else {
            var waEvsRoute = (waPrefsRoute && waPrefsRoute.events) ? waPrefsRoute.events : {};
            if (typeof waEvsRoute["maintenance_digest"] === "boolean") waRouteAllowed = waEvsRoute["maintenance_digest"];
          }
        } catch (_) { /* malformed → opt-in */ }
      }
      if (!waRouteAllowed) {
        console.log("[maintenance-reminder] route: WA skipped by prefs for user", waRecipR.id);
        continue;
      }

      if (waPhoneR.indexOf("whatsapp:") === 0) waPhoneR = waPhoneR.substring("whatsapp:".length);

      var waPayloadR = JSON.stringify({
        messaging_product: "whatsapp",
        to: waPhoneR,
        type: "text",
        text: { body: waMsgTextR }
      });

      var waSuccessR = false;
      var waWamidR = "failed";

      try {
        var waResR = $http.send({
          method: "POST",
          url: waApiUrlR,
          body: waPayloadR,
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + waTokenR
          },
          timeout: 10000
        });

        if (waResR.statusCode >= 200 && waResR.statusCode < 300) {
          waSuccessR = true;
          try {
            var waParsedR = JSON.parse(waResR.raw);
            if (waParsedR && waParsedR.messages && waParsedR.messages[0] && waParsedR.messages[0].id) {
              waWamidR = waParsedR.messages[0].id;
            }
          } catch (_) {}
          console.log("[maintenance-reminder] route: WA sent to " + waPhoneR + " wamid=" + waWamidR);
        } else {
          console.log("[maintenance-reminder] route: WA Meta API " + waResR.statusCode + ": " + waResR.raw);
        }
      } catch (waHttpErrR) {
        console.log("[maintenance-reminder] route: WA HTTP error:", waHttpErrR);
      }

      // Audit log — best-effort
      try {
        var waAuditColR = $app.dao().findCollectionByNameOrId("audit_log");
        var waAuditRecR = new Record(waAuditColR);
        waAuditRecR.set("collection_name", "messages");
        waAuditRecR.set("record_id", waWamidR);
        waAuditRecR.set("action", "send_whatsapp");
        waAuditRecR.set("changes", JSON.stringify({
          to: waPhoneR,
          event: "maintenance_digest",
          success: waSuccessR
        }));
        $app.dao().saveRecord(waAuditRecR);
      } catch (waAuditErrR) {
        console.log("[maintenance-reminder] route: audit_log WA write failed:", waAuditErrR);
      }
    }
  } else {
    console.log("[maintenance-reminder] route: WHATSAPP_PHONE_NUMBER_ID/TOKEN not set — skipping WA.");
  }

  return c.json(200, { fired: true, skipped: null, due: due.length, sent: sent });
});
