/// <reference path="../pb_data/types.d.ts" />
// Telegram group digest — scheduled daily summary posted to a Telegram group chat.
//
// Cron: daily 08:00 UTC by default (override via TG_DIGEST_CRON env var).
// Manual trigger: POST /api/tg/digest/run (admin only). Supports ?dry=1 (or JSON
// body { "dry": true }) to build + return the digest text WITHOUT sending — works
// without Telegram credentials, useful for previewing content.
//
// Three digest sections:
//   1. Open requests (status=open|approved)
//   2. Overdue returns (status=fulfilled, expected_return in the past)
//   3. Maintenance due within 7 days (kit_maintenance_schedules — graceful if absent)
//
// Environment (Fly secrets):
//   TELEGRAM_BOT_TOKEN     — from @BotFather
//   TELEGRAM_GROUP_CHAT_ID — group chat ID (add bot to group, read from getUpdates)
//   TG_DIGEST_CRON         — cron expression (default "0 8 * * *")
//
// Skips silently when either TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID is unset,
// so CI/local dev without secrets stays green.
//
// PB v0.22 Goja isolation: each cronAdd/routerAdd callback runs in its OWN runtime.
// Top-level function declarations are NOT visible inside the callbacks, so the three
// helpers (escHtml / sendTelegram / buildDigest) are defined INSIDE each callback.
// This duplication is intentional and matches wa_meta_webhook.pb.js. NO module-level
// mutable state.

// ===========================================================================
// Cron: daily digest (default 08:00 UTC, override via TG_DIGEST_CRON)
// ===========================================================================
var cronExpr = $os.getenv("TG_DIGEST_CRON") || "0 8 * * *";

cronAdd("tg_group_digest", cronExpr, function() {
  // --- helpers (must be inside the callback — Goja per-callback isolation) ---
  function escHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function sendTelegram(token, chatId, text) {
    var MAX = 4000; // stay comfortably under the 4096 Telegram limit
    var chunks = [];
    var remaining = text;
    while (remaining.length > MAX) {
      var breakAt = -1;
      var dbl = remaining.lastIndexOf("\n\n", MAX);
      if (dbl > 0) {
        breakAt = dbl + 2;
      } else {
        var nl = remaining.lastIndexOf("\n", MAX);
        if (nl > 0) {
          breakAt = nl + 1;
        } else {
          var sp = remaining.lastIndexOf(" ", MAX);
          breakAt = sp > 0 ? sp + 1 : MAX;
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());

    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    for (var i = 0; i < chunks.length; i++) {
      var res = $http.send({
        url: url,
        method: "POST",
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: "HTML",
          disable_web_page_preview: true
        }),
        headers: { "content-type": "application/json" },
        timeout: 20000
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error("Telegram API error status=" + res.statusCode + " body=" + res.raw);
      }
      console.log("[tg_digest] sent chunk " + (i + 1) + "/" + chunks.length + " status=" + res.statusCode);
    }
  }

  function buildDigest(dao) {
    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    var horizon = new Date(now.getTime() + 7 * 86400000);
    var horizonStr = horizon.toISOString().slice(0, 10);

    var lines = [];
    lines.push("<b>Kit Tracker Daily Digest — " + escHtml(todayStr) + "</b>");
    lines.push("");

    // Section 1: Open requests
    var openReqs = [];
    try {
      openReqs = dao.findRecordsByFilter("requests", "status = 'open' || status = 'approved'", "delivery_date", 50, 0, {});
    } catch (e) { console.log("[tg_digest] open requests query error: " + e); }

    lines.push("<b>Open Requests (" + openReqs.length + ")</b>");
    if (openReqs.length === 0) {
      lines.push("  None");
    } else {
      for (var i = 0; i < openReqs.length; i++) {
        var r = openReqs[i];
        var requesterEmail = "";
        var rid = r.getString("requester") || "";
        if (rid) { try { requesterEmail = dao.findRecordById("users", rid).getString("email") || ""; } catch (_) {} }
        var kitSerial = "";
        var kid = r.getString("designated_kit") || "";
        if (kid) { try { kitSerial = dao.findRecordById("kits", kid).getString("serial") || ""; } catch (_) {} }
        var targetEntityName = "";
        var eid = r.getString("target_entity") || "";
        if (eid) { try { targetEntityName = dao.findRecordById("entities", eid).getString("name") || ""; } catch (_) {} }
        var parts = [escHtml(r.getString("status") || "")];
        if (requesterEmail) parts.push("by " + escHtml(requesterEmail));
        if (kitSerial) parts.push("kit=" + escHtml(kitSerial));
        if (targetEntityName) parts.push("to=" + escHtml(targetEntityName));
        var deliveryDate = r.getString("delivery_date") || "";
        if (deliveryDate) parts.push("due=" + escHtml(deliveryDate));
        lines.push("  • " + parts.join(", "));
      }
    }
    lines.push("");

    // Section 2: Overdue returns
    var overdueReqs = [];
    try {
      overdueReqs = dao.findRecordsByFilter("requests", "status = 'fulfilled' && expected_return != '' && expected_return < {:today}", "-expected_return", 100, 0, { today: todayStr });
    } catch (e) { console.log("[tg_digest] overdue returns query error: " + e); }

    lines.push("<b>Overdue Returns (" + overdueReqs.length + ")</b>");
    if (overdueReqs.length === 0) {
      lines.push("  None");
    } else {
      for (var j = 0; j < overdueReqs.length; j++) {
        var or = overdueReqs[j];
        var kitSerial2 = "";
        var kid2 = or.getString("designated_kit") || "";
        if (kid2) { try { kitSerial2 = dao.findRecordById("kits", kid2).getString("serial") || ""; } catch (_) {} }
        var requesterEmail2 = "";
        var rid2 = or.getString("requester") || "";
        if (rid2) { try { requesterEmail2 = dao.findRecordById("users", rid2).getString("email") || ""; } catch (_) {} }
        var expectedReturn = or.getString("expected_return") || "";
        var dueMs = new Date(expectedReturn).getTime();
        var daysOverdue = isNaN(dueMs) ? 0 : Math.max(0, Math.floor((now.getTime() - dueMs) / 86400000));
        var orParts = [];
        if (kitSerial2) orParts.push("kit=" + escHtml(kitSerial2));
        if (expectedReturn) orParts.push("due=" + escHtml(expectedReturn));
        orParts.push("overdue " + daysOverdue + "d");
        if (requesterEmail2) orParts.push("by " + escHtml(requesterEmail2));
        lines.push("  • " + orParts.join(", "));
      }
    }
    lines.push("");

    // Section 3: Maintenance due (next 7 days)
    var schedules = [];
    var maintNote = "";
    try {
      schedules = dao.findRecordsByFilter("kit_maintenance_schedules", "is_active = true && next_due_at <= {:horizon}", "next_due_at", 100, 0, { horizon: horizonStr });
    } catch (_) {
      maintNote = " (kit_maintenance_schedules collection not available)";
    }
    // Schedules target EITHER a kit OR a component (XOR — see
    // maintenance_xor_target.pb.js + migration 1779300000). Handle both, else
    // component-only schedules silently vanish from the digest.
    var dueItems = [];
    for (var k = 0; k < schedules.length; k++) {
      var s = schedules[k];
      var schedKit = s.getString("kit") || "";
      var schedComp = s.getString("component") || "";
      var targetLabel = "";
      if (schedKit) {
        try {
          var kit = dao.findRecordById("kits", schedKit);
          if (!kit || !kit.getBool("is_active")) continue;
          targetLabel = kit.getString("serial") || "";
        } catch (_) { continue; }
      } else if (schedComp) {
        try {
          var comp = dao.findRecordById("components", schedComp);
          if (!comp) continue;
          targetLabel = (comp.getString("serial") || "") + " (component)";
        } catch (_) { continue; }
      } else {
        continue;
      }
      dueItems.push({
        target: escHtml(targetLabel),
        nextDue: escHtml(s.getString("next_due_at") || ""),
        type: escHtml(s.getString("type") || "")
      });
    }
    lines.push("<b>Maintenance Due (next 7 days) — " + dueItems.length + maintNote + "</b>");
    if (dueItems.length === 0) {
      lines.push("  None" + maintNote);
    } else {
      for (var m = 0; m < dueItems.length; m++) {
        var d = dueItems[m];
        var mParts = [];
        if (d.target) mParts.push("item=" + d.target);
        if (d.type) mParts.push("type=" + d.type);
        if (d.nextDue) mParts.push("due=" + d.nextDue);
        lines.push("  • " + mParts.join(", "));
      }
    }

    if (openReqs.length === 0 && overdueReqs.length === 0 && dueItems.length === 0) {
      return "✅ All clear — no open requests, overdue returns, or maintenance due.";
    }
    return lines.join("\n");
  }

  // --- cron body ---
  try {
    var token  = $os.getenv("TELEGRAM_BOT_TOKEN")     || "";
    var chatId = $os.getenv("TELEGRAM_GROUP_CHAT_ID") || "";
    if (!token || !chatId) {
      console.log("[tg_digest] TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID not set — skipping");
      return;
    }
    var digest = buildDigest($app.dao());
    console.log("[tg_digest] sending digest chars=" + digest.length);
    sendTelegram(token, chatId, digest);
    console.log("[tg_digest] done");
  } catch (err) {
    console.log("[tg_digest] error: " + err);
  }
});

// ===========================================================================
// Manual admin trigger: POST /api/tg/digest/run  (?dry=1 to preview only)
// ===========================================================================
routerAdd("POST", "/api/tg/digest/run", function(c) {
  // --- helpers (must be inside the callback — Goja per-callback isolation) ---
  function escHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function sendTelegram(token, chatId, text) {
    var MAX = 4000;
    var chunks = [];
    var remaining = text;
    while (remaining.length > MAX) {
      var breakAt = -1;
      var dbl = remaining.lastIndexOf("\n\n", MAX);
      if (dbl > 0) {
        breakAt = dbl + 2;
      } else {
        var nl = remaining.lastIndexOf("\n", MAX);
        if (nl > 0) {
          breakAt = nl + 1;
        } else {
          var sp = remaining.lastIndexOf(" ", MAX);
          breakAt = sp > 0 ? sp + 1 : MAX;
        }
      }
      chunks.push(remaining.slice(0, breakAt).trimRight());
      remaining = remaining.slice(breakAt);
    }
    if (remaining.trim()) chunks.push(remaining.trim());

    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    for (var i = 0; i < chunks.length; i++) {
      var res = $http.send({
        url: url,
        method: "POST",
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: "HTML",
          disable_web_page_preview: true
        }),
        headers: { "content-type": "application/json" },
        timeout: 20000
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error("Telegram API error status=" + res.statusCode + " body=" + res.raw);
      }
      console.log("[tg_digest] sent chunk " + (i + 1) + "/" + chunks.length + " status=" + res.statusCode);
    }
  }

  function buildDigest(dao) {
    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    var horizon = new Date(now.getTime() + 7 * 86400000);
    var horizonStr = horizon.toISOString().slice(0, 10);

    var lines = [];
    lines.push("<b>Kit Tracker Daily Digest — " + escHtml(todayStr) + "</b>");
    lines.push("");

    var openReqs = [];
    try {
      openReqs = dao.findRecordsByFilter("requests", "status = 'open' || status = 'approved'", "delivery_date", 50, 0, {});
    } catch (e) { console.log("[tg_digest] open requests query error: " + e); }

    lines.push("<b>Open Requests (" + openReqs.length + ")</b>");
    if (openReqs.length === 0) {
      lines.push("  None");
    } else {
      for (var i = 0; i < openReqs.length; i++) {
        var r = openReqs[i];
        var requesterEmail = "";
        var rid = r.getString("requester") || "";
        if (rid) { try { requesterEmail = dao.findRecordById("users", rid).getString("email") || ""; } catch (_) {} }
        var kitSerial = "";
        var kid = r.getString("designated_kit") || "";
        if (kid) { try { kitSerial = dao.findRecordById("kits", kid).getString("serial") || ""; } catch (_) {} }
        var targetEntityName = "";
        var eid = r.getString("target_entity") || "";
        if (eid) { try { targetEntityName = dao.findRecordById("entities", eid).getString("name") || ""; } catch (_) {} }
        var parts = [escHtml(r.getString("status") || "")];
        if (requesterEmail) parts.push("by " + escHtml(requesterEmail));
        if (kitSerial) parts.push("kit=" + escHtml(kitSerial));
        if (targetEntityName) parts.push("to=" + escHtml(targetEntityName));
        var deliveryDate = r.getString("delivery_date") || "";
        if (deliveryDate) parts.push("due=" + escHtml(deliveryDate));
        lines.push("  • " + parts.join(", "));
      }
    }
    lines.push("");

    var overdueReqs = [];
    try {
      overdueReqs = dao.findRecordsByFilter("requests", "status = 'fulfilled' && expected_return != '' && expected_return < {:today}", "-expected_return", 100, 0, { today: todayStr });
    } catch (e) { console.log("[tg_digest] overdue returns query error: " + e); }

    lines.push("<b>Overdue Returns (" + overdueReqs.length + ")</b>");
    if (overdueReqs.length === 0) {
      lines.push("  None");
    } else {
      for (var j = 0; j < overdueReqs.length; j++) {
        var or = overdueReqs[j];
        var kitSerial2 = "";
        var kid2 = or.getString("designated_kit") || "";
        if (kid2) { try { kitSerial2 = dao.findRecordById("kits", kid2).getString("serial") || ""; } catch (_) {} }
        var requesterEmail2 = "";
        var rid2 = or.getString("requester") || "";
        if (rid2) { try { requesterEmail2 = dao.findRecordById("users", rid2).getString("email") || ""; } catch (_) {} }
        var expectedReturn = or.getString("expected_return") || "";
        var dueMs = new Date(expectedReturn).getTime();
        var daysOverdue = isNaN(dueMs) ? 0 : Math.max(0, Math.floor((now.getTime() - dueMs) / 86400000));
        var orParts = [];
        if (kitSerial2) orParts.push("kit=" + escHtml(kitSerial2));
        if (expectedReturn) orParts.push("due=" + escHtml(expectedReturn));
        orParts.push("overdue " + daysOverdue + "d");
        if (requesterEmail2) orParts.push("by " + escHtml(requesterEmail2));
        lines.push("  • " + orParts.join(", "));
      }
    }
    lines.push("");

    var schedules = [];
    var maintNote = "";
    try {
      schedules = dao.findRecordsByFilter("kit_maintenance_schedules", "is_active = true && next_due_at <= {:horizon}", "next_due_at", 100, 0, { horizon: horizonStr });
    } catch (_) {
      maintNote = " (kit_maintenance_schedules collection not available)";
    }
    // Schedules target EITHER a kit OR a component (XOR — see
    // maintenance_xor_target.pb.js + migration 1779300000). Handle both, else
    // component-only schedules silently vanish from the digest.
    var dueItems = [];
    for (var k = 0; k < schedules.length; k++) {
      var s = schedules[k];
      var schedKit = s.getString("kit") || "";
      var schedComp = s.getString("component") || "";
      var targetLabel = "";
      if (schedKit) {
        try {
          var kit = dao.findRecordById("kits", schedKit);
          if (!kit || !kit.getBool("is_active")) continue;
          targetLabel = kit.getString("serial") || "";
        } catch (_) { continue; }
      } else if (schedComp) {
        try {
          var comp = dao.findRecordById("components", schedComp);
          if (!comp) continue;
          targetLabel = (comp.getString("serial") || "") + " (component)";
        } catch (_) { continue; }
      } else {
        continue;
      }
      dueItems.push({
        target: escHtml(targetLabel),
        nextDue: escHtml(s.getString("next_due_at") || ""),
        type: escHtml(s.getString("type") || "")
      });
    }
    lines.push("<b>Maintenance Due (next 7 days) — " + dueItems.length + maintNote + "</b>");
    if (dueItems.length === 0) {
      lines.push("  None" + maintNote);
    } else {
      for (var m = 0; m < dueItems.length; m++) {
        var d = dueItems[m];
        var mParts = [];
        if (d.target) mParts.push("item=" + d.target);
        if (d.type) mParts.push("type=" + d.type);
        if (d.nextDue) mParts.push("due=" + d.nextDue);
        lines.push("  • " + mParts.join(", "));
      }
    }

    if (openReqs.length === 0 && overdueReqs.length === 0 && dueItems.length === 0) {
      return "✅ All clear — no open requests, overdue returns, or maintenance due.";
    }
    return lines.join("\n");
  }

  // --- handler body ---
  // Auth gate — admin only
  var info = $apis.requestInfo(c);
  if (!info || !info.authRecord || info.authRecord.getString("role") !== "admin") {
    return c.json(403, { error: "admin only" });
  }

  // Detect dry-run from query param (?dry=1) or JSON body ({ "dry": true })
  var dryParam = c.queryParam("dry") || "";
  var isDry = dryParam === "1" || dryParam === "true" || !!(info.data && info.data.dry);

  // Build digest (runs before the cred check so dry-run works without secrets)
  var digest;
  try {
    digest = buildDigest($app.dao());
  } catch (buildErr) {
    console.log("[tg_digest] manual trigger: buildDigest error: " + buildErr);
    return c.json(500, { error: "digest build failed: " + String(buildErr) });
  }

  // Dry-run: return digest text without sending, no creds required
  if (isDry) {
    console.log("[tg_digest] dry-run: chars=" + digest.length);
    return c.json(200, { dry: true, chars: digest.length, text: digest });
  }

  // Env check — read at call time (Goja isolation)
  var token  = $os.getenv("TELEGRAM_BOT_TOKEN")     || "";
  var chatId = $os.getenv("TELEGRAM_GROUP_CHAT_ID") || "";
  if (!token || !chatId) {
    console.log("[tg_digest] manual trigger: TELEGRAM_BOT_TOKEN or TELEGRAM_GROUP_CHAT_ID not set");
    return c.json(500, { error: "Telegram credentials not configured" });
  }

  try {
    sendTelegram(token, chatId, digest);
    console.log("[tg_digest] manual trigger: sent chars=" + digest.length);
    return c.json(200, { sent: true, chars: digest.length });
  } catch (sendErr) {
    console.log("[tg_digest] manual trigger: send error: " + sendErr);
    return c.json(502, { error: "telegram send failed: " + String(sendErr) });
  }
});
