/// <reference path="../pb_data/types.d.ts" />
// Nightly 08:15 UTC: email all admins + on-call technicians about products
// whose on-hand count is below their reorder_point threshold.
//
// NOTE on PB v0.22 Goja scoping: routerAdd and cronAdd callbacks run in
// isolated Goja pool runtimes — they cannot reference functions declared at
// file scope.  All logic is therefore inlined into each callback.

// ---------------------------------------------------------------------------
// Shared inline logic — duplicated inside cron + route callbacks.
// ---------------------------------------------------------------------------

// cronAdd callback — no closure over file-scope names
cronAdd("reorderLowStockReminder", "15 8 * * *", function() {
  console.log("[reorder-low-stock-reminder] cron firing at", new Date().toISOString());

  function escReorder(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var todayStr = new Date().toISOString().slice(0, 10);

  var products = [];
  try {
    products = $app.dao().findRecordsByFilter(
      "products",
      "reorder_point != null && is_active = true",
      "name",
      200,
      0,
      {}
    );
  } catch (queryErr) {
    console.log("[reorder-low-stock-reminder] cron: failed to query products:", queryErr);
    return;
  }

  var low = [];
  for (var i = 0; i < products.length; i++) {
    var product = products[i];
    var reorderPoint = product.getInt("reorder_point");
    var isSerialized = product.getBool("is_serialized");

    var components = [];
    try {
      components = $app.dao().findRecordsByFilter(
        "components",
        "product = {:pid} && is_active = true",
        "",
        500,
        0,
        { pid: product.id }
      );
    } catch (e) {
      console.log("[reorder-low-stock-reminder] cron: component lookup failed for product", product.id);
      continue;
    }

    var onHand;
    if (isSerialized === true) {
      onHand = components.length;
    } else {
      onHand = 0;
      for (var ci = 0; ci < components.length; ci++) {
        onHand += components[ci].getInt("quantity") || 0;
      }
    }

    if (onHand < reorderPoint) {
      low.push({ product: product, on_hand: onHand, reorder_point: reorderPoint });
    }
  }

  if (low.length === 0) {
    console.log("[reorder-low-stock-reminder] cron: no low-stock products.");
    return;
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[reorder-low-stock-reminder] cron: failed to query admins:", queryErr);
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
    console.log("[reorder-low-stock-reminder] cron: on-call lookup failed:", e);
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
  if (recipientIdsCron.length === 0) { console.log("[reorder-low-stock-reminder] cron: no recipients."); return; }

  var rows = [];
  for (var j = 0; j < low.length; j++) {
    var item = low[j];
    rows.push(
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'><b>" + escReorder(item.product.getString("name")) + "</b></td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(item.product.getString("category")) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(String(item.on_hand)) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(String(item.reorder_point)) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(item.product.getString("manufacturer")) + "</td>" +
      "</tr>"
    );
  }

  var htmlBody =
    "<h2>Low-stock digest</h2>" +
    "<p>" + low.length + " product(s) below reorder threshold as of " + escReorder(todayStr) + ":</p>" +
    "<table style='border-collapse:collapse'>" +
    "<thead><tr>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Product</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Category</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>On-hand</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Reorder point</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Manufacturer</th>" +
    "</tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table>";

  var subject = "Kit Tracker: " + low.length + " product(s) below reorder threshold";
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
      console.log("[reorder-low-stock-reminder] cron: notified:", recipientEmail);
      sent++;
    } catch (mailErr) {
      var mailErrStr = String(mailErr);
      if (mailErrStr.indexOf("smtp") !== -1 || mailErrStr.indexOf("SMTP") !== -1 || mailErrStr.indexOf("dial") !== -1) {
        console.log("[reorder-low-stock-reminder] cron: SMTP not configured, skipping:", recipientEmail);
      } else {
        console.log("[reorder-low-stock-reminder] cron: failed to send to " + recipientEmail + ":", mailErr);
      }
    }
  }

  console.log("[reorder-low-stock-reminder] cron: done — low:", low.length, "sent:", sent);
});

// ---------------------------------------------------------------------------
// Manual trigger route for testing (admin only).
// POST /_test/reorder-low-stock-reminder
// All logic inlined — routerAdd callbacks run in isolated Goja contexts.
// ---------------------------------------------------------------------------
routerAdd("POST", "/_test/reorder-low-stock-reminder", function(c) {
  var info = $apis.requestInfo(c);
  if (!info.admin) {
    var authRecord = info.authRecord;
    if (!authRecord || authRecord.getString("role") !== "admin") {
      throw new ForbiddenError("admin only");
    }
  }

  console.log("[reorder-low-stock-reminder] manual trigger via /_test/reorder-low-stock-reminder");

  function escReorder(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var todayStr = new Date().toISOString().slice(0, 10);

  var products = [];
  try {
    products = $app.dao().findRecordsByFilter(
      "products",
      "reorder_point != null && is_active = true",
      "name",
      200,
      0,
      {}
    );
  } catch (queryErr) {
    console.log("[reorder-low-stock-reminder] route: failed to query products:", queryErr);
    return c.json(200, { fired: true, skipped: "query_error", low: 0, sent: 0 });
  }

  var low = [];
  for (var i = 0; i < products.length; i++) {
    var product = products[i];
    var reorderPoint = product.getInt("reorder_point");
    var isSerialized = product.getBool("is_serialized");

    var components = [];
    try {
      components = $app.dao().findRecordsByFilter(
        "components",
        "product = {:pid} && is_active = true",
        "",
        500,
        0,
        { pid: product.id }
      );
    } catch (e) {
      console.log("[reorder-low-stock-reminder] route: component lookup failed for product", product.id);
      continue;
    }

    var onHand;
    if (isSerialized === true) {
      onHand = components.length;
    } else {
      onHand = 0;
      for (var ci = 0; ci < components.length; ci++) {
        onHand += components[ci].getInt("quantity") || 0;
      }
    }

    if (onHand < reorderPoint) {
      low.push({ product: product, on_hand: onHand, reorder_point: reorderPoint });
    }
  }

  if (low.length === 0) {
    console.log("[reorder-low-stock-reminder] route: no low-stock products.");
    return c.json(200, { fired: true, skipped: "no_low_stock", low: 0, sent: 0 });
  }

  var admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[reorder-low-stock-reminder] route: failed to query admins:", queryErr);
    return c.json(200, { fired: true, skipped: "admin_query_error", low: low.length, sent: 0 });
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
    console.log("[reorder-low-stock-reminder] route: on-call lookup failed:", e);
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
    return c.json(200, { fired: true, skipped: "no_recipients", low: low.length, sent: 0 });
  }

  // Short-circuit when SMTP is not configured — surfaces a clear signal to admins
  // running the manual trigger rather than reporting sent=0 with no reason.
  var smtpEnabled = false;
  try {
    var smtpSettings = $app.settings().smtp;
    smtpEnabled = !!(smtpSettings && smtpSettings.enabled === true);
  } catch (e) { /* default false */ }
  if (!smtpEnabled) {
    console.log("[reorder-low-stock-reminder] route: SMTP not configured, would-send=" + recipientIdsRoute.length);
    return c.json(200, { fired: true, skipped: "smtp_unconfigured", low: low.length, sent: 0 });
  }

  var rows = [];
  for (var j = 0; j < low.length; j++) {
    var item = low[j];
    rows.push(
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'><b>" + escReorder(item.product.getString("name")) + "</b></td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(item.product.getString("category")) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(String(item.on_hand)) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(String(item.reorder_point)) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escReorder(item.product.getString("manufacturer")) + "</td>" +
      "</tr>"
    );
  }

  var htmlBody =
    "<h2>Low-stock digest</h2>" +
    "<p>" + low.length + " product(s) below reorder threshold as of " + escReorder(todayStr) + ":</p>" +
    "<table style='border-collapse:collapse'>" +
    "<thead><tr>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Product</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Category</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>On-hand</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Reorder point</th>" +
    "<th style='padding:4px 12px 4px 0;text-align:left'>Manufacturer</th>" +
    "</tr></thead>" +
    "<tbody>" + rows.join("") + "</tbody></table>";

  var subject = "Kit Tracker: " + low.length + " product(s) below reorder threshold";
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
      console.log("[reorder-low-stock-reminder] route: notified:", recipientEmail);
      sent++;
    } catch (mailErr) {
      var mailErrStr = String(mailErr);
      if (mailErrStr.indexOf("smtp") !== -1 || mailErrStr.indexOf("SMTP") !== -1 || mailErrStr.indexOf("dial") !== -1) {
        console.log("[reorder-low-stock-reminder] route: SMTP not configured, skipping:", recipientEmail);
      } else {
        console.log("[reorder-low-stock-reminder] route: failed to send to " + recipientEmail + ":", mailErr);
      }
    }
  }

  console.log("[reorder-low-stock-reminder] route: done — low:", low.length, "sent:", sent);

  return c.json(200, { fired: true, skipped: null, low: low.length, sent: sent });
});
