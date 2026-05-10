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

  const subject = "New kit request from " + (requesterName || requesterEmail || "a user");

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

  // Fetch all admins (limit 100; paginate if ever >100).
  let admins = [];
  try {
    admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
  } catch (queryErr) {
    console.log("[request_created_notify] Failed to query admins:", queryErr);
    return;
  }

  const senderAddress = $app.settings().meta.senderAddress || ($os.getenv("SMTP_FROM") || "notifications@kit.local");
  const senderName = $app.settings().meta.senderName || "Kit Tracker";
  const requesterId = record.getString("requester");

  for (let i = 0; i < admins.length; i++) {
    const admin = admins[i];
    // Don't email an admin who is also the requester (no self-notification).
    if (admin.id === requesterId) {
      continue;
    }
    const adminEmail = admin.getString("email");
    const adminName = admin.getString("name") || adminEmail;
    if (!adminEmail) {
      continue;
    }

    try {
      const message = new MailerMessage({
        from: {
          address: senderAddress,
          name: senderName,
        },
        to: [{ address: adminEmail, name: adminName }],
        subject: subject,
        html: htmlBody,
      });
      $app.newMailClient().send(message);
      console.log("[request_created_notify] Notified admin:", adminEmail);
    } catch (mailErr) {
      // Likely smtp not configured; log and continue so remaining admins still receive.
      const msg = String(mailErr);
      if (msg.indexOf("smtp") !== -1 || msg.indexOf("SMTP") !== -1 || msg.indexOf("dial") !== -1) {
        console.log("[request_created_notify] smtp not configured, skipping notification for:", adminEmail);
      } else {
        console.log("[request_created_notify] Failed to send to " + adminEmail + ":", mailErr);
      }
    }
  }
}, "requests");
