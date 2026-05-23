/// <reference path="../pb_data/types.d.ts" />
// Cron runner for scheduled_broadcasts collection.
//
// Registers a every-minute cron. Each tick:
//   1. Fetches all enabled scheduled_broadcasts.
//   2. For each, checks if NOW matches its cron_expression.
//   3. If yes, runs the broadcast logic (inlined from wa_meta_broadcast.pb.js).
//   4. Updates last_run_at + last_result on the record.
//
// Cron matcher supports: * N N,M */N per field (minute/hour/dom/month/dow).
// Errors per broadcast are caught and logged — one failure does not block others.
//
// NO module-level vars — PB v0.22 Goja isolation.

// ---------------------------------------------------------------------------
// Inline cron field matcher
// ---------------------------------------------------------------------------

function matchCronField(expr, value, min, max) {
  // "*" matches any
  if (expr === "*") return true;

  var parts = expr.split(",");
  for (var pi = 0; pi < parts.length; pi++) {
    var part = parts[pi];

    // "*/N" — step
    if (part.indexOf("*/") === 0) {
      var step = parseInt(part.slice(2), 10);
      if (!isNaN(step) && step > 0 && ((value - min) % step === 0)) return true;
      continue;
    }

    // "N-M/S" or "N-M" — range (optionally with step)
    if (part.indexOf("-") !== -1) {
      var rangeParts = part.split("/");
      var rangeStr = rangeParts[0];
      var rangeStep = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : 1;
      var bounds = rangeStr.split("-");
      var lo = parseInt(bounds[0], 10);
      var hi = parseInt(bounds[1], 10);
      if (!isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi) {
        if (isNaN(rangeStep) || rangeStep <= 0) rangeStep = 1;
        if ((value - lo) % rangeStep === 0) return true;
      }
      continue;
    }

    // Plain number
    var n = parseInt(part, 10);
    if (!isNaN(n) && n === value) return true;
  }
  return false;
}

function cronMatches(expression, now) {
  // Parse "minute hour dom month dow"
  var fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    console.log("[sched_bcast_cron] invalid cron expr (not 5 fields): " + expression);
    return false;
  }

  var minute  = now.getUTCMinutes();
  var hour    = now.getUTCHours();
  var dom     = now.getUTCDate();
  var month   = now.getUTCMonth() + 1; // 1-12
  var dow     = now.getUTCDay();       // 0=Sun … 6=Sat

  return (
    matchCronField(fields[0], minute, 0, 59) &&
    matchCronField(fields[1], hour,   0, 23) &&
    matchCronField(fields[2], dom,    1, 31) &&
    matchCronField(fields[3], month,  1, 12) &&
    matchCronField(fields[4], dow,    0,  6)
  );
}

// ---------------------------------------------------------------------------
// Inline broadcast sender (mirrors wa_meta_broadcast.pb.js logic)
// Does NOT require any auth record — runs in cron context.
// Returns { totalRecipients, successCount, failed: [{phone, error}] }
// ---------------------------------------------------------------------------

function runBroadcast(recipientFilter, message, phoneId, token) {
  var phones = [];
  var filterType = recipientFilter.type;
  var msgType    = message.type;
  var msgText    = (message.text || "").toString().trim();
  var msgTemplate= message.template || null;

  // Resolve phones
  if (filterType === "role") {
    var role = (recipientFilter.value || "").toString().trim();
    var userRecords = [];
    try {
      userRecords = $app.dao().findRecordsByFilter(
        "users",
        "role = {:role} && phone != ''",
        "-created",
        0,
        500,
        { role: role }
      );
    } catch (e) {
      console.log("[sched_bcast_cron] users query error: " + e);
      return { totalRecipients: 0, successCount: 0, failed: [{ phone: "", error: "users query: " + String(e) }] };
    }
    for (var i = 0; i < userRecords.length; i++) {
      var phone = (userRecords[i].getString("phone") || "").trim();
      if (phone) phones.push(phone);
    }
  } else if (filterType === "phones") {
    var rawPhones = recipientFilter.value;
    if (Array.isArray(rawPhones)) {
      for (var j = 0; j < rawPhones.length; j++) {
        var p = (rawPhones[j] || "").toString().trim();
        if (p) phones.push(p);
      }
    }
  }

  if (phones.length === 0) {
    return { totalRecipients: 0, successCount: 0, failed: [], message: "No recipients with phone numbers" };
  }

  var successCount = 0;
  var failed = [];

  for (var k = 0; k < phones.length; k++) {
    var toPhone = phones[k];
    var metaPayload;

    if (msgType === "text") {
      metaPayload = {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: msgText }
      };
    } else {
      metaPayload = {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "template",
        template: {
          name: msgTemplate.name,
          language: { code: msgTemplate.language || "en_US" }
        }
      };
    }

    var sendSuccess = false;
    var sendError   = "";

    try {
      var metaRes = $http.send({
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
        sendSuccess = true;
        console.log("[sched_bcast_cron] sent to=" + toPhone + " mode=" + msgType + " status=" + metaRes.statusCode);
      } else {
        sendError = "Meta API status " + metaRes.statusCode + ": " + metaRes.raw;
        console.log("[sched_bcast_cron] Meta error to=" + toPhone + " status=" + metaRes.statusCode);
      }
    } catch (e) {
      sendError = "HTTP error: " + String(e);
      console.log("[sched_bcast_cron] HTTP error to=" + toPhone + ": " + e);
    }

    if (sendSuccess) {
      successCount++;
    } else {
      failed.push({ phone: toPhone, error: sendError });
    }

    // Audit log — non-fatal
    try {
      var auditCol = $app.dao().findCollectionByNameOrId("audit_log");
      var auditRec = new Record(auditCol);
      auditRec.set("actor", "");
      auditRec.set("action", "send_whatsapp");
      auditRec.set("collection_name", "messages");
      auditRec.set("record_id", toPhone);
      var changesObj = {
        to: toPhone,
        mode: msgType,
        success: sendSuccess,
        via: "scheduled_broadcast",
        filterType: filterType
      };
      if (msgType === "text") {
        changesObj.textPreview = msgText.length > 80 ? msgText.substring(0, 80) + "..." : msgText;
      } else if (msgTemplate && msgTemplate.name) {
        changesObj.templateName = msgTemplate.name;
      }
      if (!sendSuccess) changesObj.error = sendError;
      auditRec.set("changes", JSON.stringify(changesObj));
      $app.dao().saveRecord(auditRec);
    } catch (auditErr) {
      console.log("[sched_bcast_cron] audit_log write error for to=" + toPhone + ": " + auditErr);
    }
  }

  return { totalRecipients: phones.length, successCount: successCount, failed: failed };
}

// ---------------------------------------------------------------------------
// Register the every-minute cron
// ---------------------------------------------------------------------------

cronAdd("scheduled_broadcasts_runner", "* * * * *", function() {
  var now = new Date();
  console.log("[sched_bcast_cron] tick at " + now.toISOString());

  // Read credentials at call time — no module-level vars
  var phoneId = $os.getenv("WHATSAPP_PHONE_NUMBER_ID") || "";
  var token   = $os.getenv("WHATSAPP_TOKEN")           || "";

  if (!phoneId || !token) {
    console.log("[sched_bcast_cron] WA credentials not set, skipping");
    return;
  }

  var schedules = [];
  try {
    schedules = $app.dao().findRecordsByFilter(
      "scheduled_broadcasts",
      "enabled = true",
      "-created",
      0,
      200,
      {}
    );
  } catch (e) {
    console.log("[sched_bcast_cron] failed to fetch schedules: " + e);
    return;
  }

  console.log("[sched_bcast_cron] checking " + schedules.length + " enabled schedule(s)");

  for (var i = 0; i < schedules.length; i++) {
    var sched = schedules[i];
    var schedId   = sched.getId();
    var schedName = sched.getString("name");
    var cronExpr  = sched.getString("cron_expression");

    try {
      if (!cronMatches(cronExpr, now)) {
        continue;
      }

      console.log("[sched_bcast_cron] firing schedule id=" + schedId + " name=" + schedName);

      // Parse recipient_filter and message from JSON text fields
      var recipientFilter = null;
      var message         = null;
      try {
        recipientFilter = JSON.parse(sched.getString("recipient_filter") || "null");
        message         = JSON.parse(sched.getString("message") || "null");
      } catch (parseErr) {
        console.log("[sched_bcast_cron] JSON parse error for schedule id=" + schedId + ": " + parseErr);
        var errResult = { error: "JSON parse error: " + String(parseErr), successCount: 0, totalRecipients: 0, failed: [] };
        try {
          sched.set("last_run_at", now.toISOString().replace("T", " ").replace(/\.\d+Z$/, "") + " UTC");
          sched.set("last_result", JSON.stringify(errResult));
          $app.dao().saveRecord(sched);
        } catch (_) {}
        continue;
      }

      if (!recipientFilter || !message) {
        console.log("[sched_bcast_cron] null filter or message for schedule id=" + schedId);
        continue;
      }

      var result = runBroadcast(recipientFilter, message, phoneId, token);
      console.log("[sched_bcast_cron] done id=" + schedId + " success=" + result.successCount + "/" + result.totalRecipients);

      // Update last_run_at + last_result
      try {
        sched.set("last_run_at", now.toISOString().replace("T", " ").replace(/\.\d+Z$/, "") + " UTC");
        sched.set("last_result", JSON.stringify(result));
        $app.dao().saveRecord(sched);
      } catch (saveErr) {
        console.log("[sched_bcast_cron] failed to update last_run_at for id=" + schedId + ": " + saveErr);
      }

    } catch (e) {
      // Per-schedule catch — must not block others
      console.log("[sched_bcast_cron] unhandled error for schedule id=" + schedId + ": " + e);
    }
  }
});
