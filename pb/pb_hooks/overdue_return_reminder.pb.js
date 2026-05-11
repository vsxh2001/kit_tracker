/// <reference path="../pb_data/types.d.ts" />
// Daily cron: email all admins about fulfilled requests past their expected_return date.
// Fires at 08:00 UTC. Silently skips if no overdue records or no SMTP configured.

// ---------------------------------------------------------------------------
// Tiny HTML escape — user-controlled strings go into mail body.
// ---------------------------------------------------------------------------
function escHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Core reminder logic — extracted so the cron and the test route share it.
// Returns { sent: number, skipped: string|null } summary.
// ---------------------------------------------------------------------------
function fireOverdueReminder() {
  const nowDate = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Find fulfilled requests with a non-empty expected_return that is in the past.
  let overdueRequests = [];
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
    console.log("[overdue-reminder] Failed to query overdue requests:", queryErr);
    return { sent: 0, skipped: "query_error" };
  }

  if (overdueRequests.length === 0) {
    console.log("[overdue-reminder] No overdue requests — nothing to send.");
    return { sent: 0, skipped: "no_overdue" };
  }

  // Find admins.
  let admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[overdue-reminder] Failed to query admins:", queryErr);
    return { sent: 0, skipped: "admin_query_error" };
  }

  if (admins.length === 0) {
    console.log("[overdue-reminder] No admins to notify.");
    return { sent: 0, skipped: "no_admins" };
  }

  // Build table rows for each overdue request.
  const rows = overdueRequests.map(function(r) {
    let requesterEmail = "(unknown)";
    let kitSerial = "any";
    let entityName = "(unknown)";

    try {
      const requesterId = r.getString("requester");
      if (requesterId) {
        const requester = $app.dao().findRecordById("users", requesterId);
        requesterEmail = requester.getString("email") || requesterEmail;
      }
    } catch (_) {}

    try {
      const kitId = r.getString("designated_kit");
      if (kitId) {
        const kit = $app.dao().findRecordById("kits", kitId);
        kitSerial = kit.getString("serial") || kitSerial;
      }
    } catch (_) {}

    try {
      const entityId = r.getString("target_entity");
      if (entityId) {
        const entity = $app.dao().findRecordById("entities", entityId);
        entityName = entity.getString("name") || entityName;
      }
    } catch (_) {}

    const dueDate = r.getString("expected_return") || "";
    const baseUrl = $os.getenv("APP_BASE_URL") || "http://localhost:5173";
    const requestUrl = baseUrl + "/requests/" + r.id;

    return (
      "<tr>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(kitSerial) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(entityName) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(requesterEmail) + "</td>" +
      "<td style='padding:4px 12px 4px 0'>" + escHtml(dueDate) + "</td>" +
      "<td style='padding:4px 12px 4px 0'><a href='" + escHtml(requestUrl) + "'>View</a></td>" +
      "</tr>"
    );
  });

  const htmlBody =
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

  const subject = "Kit Tracker: " + overdueRequests.length + " overdue return(s)";

  const senderAddress =
    ($app.settings().meta && $app.settings().meta.senderAddress) ||
    $os.getenv("SMTP_FROM") ||
    "notifications@kit.local";
  const senderName =
    ($app.settings().meta && $app.settings().meta.senderName) || "Kit Tracker";

  let sent = 0;
  for (let i = 0; i < admins.length; i++) {
    const admin = admins[i];
    const adminEmail = admin.getString("email");
    const adminName = admin.getString("name") || adminEmail;
    if (!adminEmail) continue;

    try {
      const message = new MailerMessage({
        from: { address: senderAddress, name: senderName },
        to: [{ address: adminEmail, name: adminName }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[overdue-reminder] Notified admin:", adminEmail);
      sent++;
    } catch (mailErr) {
      const msg = String(mailErr);
      if (
        msg.indexOf("smtp") !== -1 ||
        msg.indexOf("SMTP") !== -1 ||
        msg.indexOf("dial") !== -1
      ) {
        console.log("[overdue-reminder] SMTP not configured, skipping:", adminEmail);
      } else {
        console.log("[overdue-reminder] Failed to send to " + adminEmail + ":", mailErr);
      }
    }
  }

  return { sent: sent, skipped: null };
}

// ---------------------------------------------------------------------------
// Daily cron — 08:00 UTC.
// ---------------------------------------------------------------------------
cronAdd("overdueReturnReminder", "0 8 * * *", function() {
  console.log("[overdue-reminder] cron firing at", new Date().toISOString());
  const result = fireOverdueReminder();
  console.log("[overdue-reminder] done — sent:", result.sent, "skipped:", result.skipped);
});

// ---------------------------------------------------------------------------
// Manual trigger route for testing (admin only).
// POST /_test/overdue-reminder
// ---------------------------------------------------------------------------
routerAdd("POST", "/_test/overdue-reminder", function(c) {
  const info = $apis.requestInfo(c);

  // Reject non-admins. Superadmins (PB admin panel) are allowed through.
  if (!info.admin) {
    const authRecord = info.authRecord;
    if (!authRecord || authRecord.getString("role") !== "admin") {
      throw new ForbiddenError("admin only");
    }
  }

  console.log("[overdue-reminder] manual trigger via /_test/overdue-reminder");
  const result = fireOverdueReminder();
  return c.json(200, { fired: true, sent: result.sent, skipped: result.skipped });
});
