/// <reference path="../pb_data/types.d.ts" />
// Email all admin users when a new request record is created.
// Hook fires after the record is saved — throwing here does NOT roll back the create,
// but it does break the HTTP response. Always catch and log; never re-throw.

onRecordAfterCreateRequest((e) => {
  const record = e.record;

  // Tiny HTML escape — names are user-controlled.
  function esc(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Expand relations for email body.
  // Each expand call may throw if the record ID is empty/not found — guard individually.
  let requesterName = "";
  let requesterEmail = "";
  try {
    const requester = $app.dao().findRecordById("users", record.getString("requester"));
    requesterName = requester.getString("name") || requester.getString("email");
    requesterEmail = requester.getString("email");
  } catch (expandErr) {
    console.log("[request_created_notify] Could not expand requester:", expandErr);
  }

  let kitSerial = "any available";
  try {
    const designatedKitId = record.getString("designated_kit");
    if (designatedKitId) {
      const kit = $app.dao().findRecordById("kits", designatedKitId);
      kitSerial = kit.getString("serial") || "unknown";
    }
  } catch (expandErr) {
    console.log("[request_created_notify] Could not expand designated_kit:", expandErr);
  }

  let targetEntityName = "";
  try {
    const targetEntityId = record.getString("target_entity");
    if (targetEntityId) {
      const entity = $app.dao().findRecordById("entities", targetEntityId);
      targetEntityName = entity.getString("name") || "";
    }
  } catch (expandErr) {
    console.log("[request_created_notify] Could not expand target_entity:", expandErr);
  }

  const deliveryDate = record.getString("delivery_date") || "";
  const notes = record.getString("notes") || "";
  const requestId = record.id;

  // APP_BASE_URL env var; default to localhost dev URL.
  const baseUrl = $os.getenv("APP_BASE_URL") || "http://localhost:5173";
  const requestUrl = baseUrl + "/requests/" + requestId;

  const subject = "New kit request from " + (requesterName || requesterEmail || "a user").replace(/[\r\n]/g, " ");

  const htmlBody =
    "<h2>New Kit Request</h2>" +
    "<table style='border-collapse:collapse'>" +
    "<tr><td style='padding:4px 12px 4px 0;font-weight:bold'>Requester</td><td>" + esc(requesterName) + " &lt;" + esc(requesterEmail) + "&gt;</td></tr>" +
    "<tr><td style='padding:4px 12px 4px 0;font-weight:bold'>Kit</td><td>" + esc(kitSerial) + "</td></tr>" +
    "<tr><td style='padding:4px 12px 4px 0;font-weight:bold'>Target entity</td><td>" + esc(targetEntityName) + "</td></tr>" +
    "<tr><td style='padding:4px 12px 4px 0;font-weight:bold'>Delivery date</td><td>" + esc(deliveryDate) + "</td></tr>" +
    "<tr><td style='padding:4px 12px 4px 0;font-weight:bold'>Notes</td><td>" + esc(notes) + "</td></tr>" +
    "</table>" +
    "<p><a href='" + esc(requestUrl) + "'>View request &rarr;</a></p>";

  // Build recipient list: all admins + currently on-call users (deduped).
  let admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[request_created_notify] Failed to query admins:", queryErr);
    return;
  }

  const nowISO = new Date().toISOString();
  let onCallShifts = [];
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
    console.log("[request_created_notify] on-call lookup failed:", e);
  }

  // Combine admins + on-call users, deduped by id.
  const recipientsMap = {};
  for (let i = 0; i < admins.length; i++) {
    recipientsMap[admins[i].id] = admins[i];
  }
  for (let i = 0; i < onCallShifts.length; i++) {
    try {
      const u = $app.dao().findRecordById("users", onCallShifts[i].getString("user"));
      const role = u.getString("role");
      if (role === "admin" || role === "technician") {
        recipientsMap[u.id] = u;
      }
    } catch (e) { /* skip missing user */ }
  }

  const senderAddress = $app.settings().meta?.senderAddress || ($os.getenv("SMTP_FROM") || "notifications@kit.local");
  const senderName = $app.settings().meta?.senderName || "Kit Tracker";
  const requesterId = record.getString("requester");
  const recipientIds = Object.keys(recipientsMap);

  for (let i = 0; i < recipientIds.length; i++) {
    const recipient = recipientsMap[recipientIds[i]];
    // Don't email a recipient who is also the requester (no self-notification).
    if (recipient.id === requesterId) {
      continue;
    }
    const recipientEmail = recipient.getString("email");
    const recipientName = recipient.getString("name") || recipientEmail;
    if (!recipientEmail) {
      continue;
    }

    try {
      const message = new MailerMessage({
        from: {
          address: senderAddress,
          name: senderName,
        },
        to: [{ address: recipientEmail, name: recipientName }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[request_created_notify] Notified:", recipientEmail);
    } catch (mailErr) {
      // Likely smtp not configured; log and continue so remaining recipients still receive.
      const msg = String(mailErr);
      if (msg.indexOf("smtp") !== -1 || msg.indexOf("SMTP") !== -1 || msg.indexOf("dial") !== -1) {
        console.log("[request_created_notify] smtp not configured, skipping notification for:", recipientEmail);
      } else {
        console.log("[request_created_notify] Failed to send to " + recipientEmail + ":", mailErr);
      }
    }
  }
}, "requests");
