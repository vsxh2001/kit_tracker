/// <reference path="../pb_data/types.d.ts" />
// Email all admin users (+ current on-call) when a new user signs up with an empty role.
// Hook fires after the record is saved — throwing here does NOT roll back the create,
// but it does break the HTTP response. Always catch and log; never re-throw.
//
// Two trigger paths because PB v0.22 splits user creation:
//   1. onRecordAfterCreateRequest — fires for HTTP create (email/password signup)
//   2. onRecordAfterAuthWithOAuth2Request — fires for OAuth signup; record may
//      be NEW (first sign-in) or existing (re-login). Notify only when
//      e.isNewRecord === true.
//
// CRITICAL: PB v0.22 Goja isolates each onRecord*/onModel* callback in its own
// runtime — module-level function declarations are NOT visible inside callbacks
// (see project_pb_module_state_isolation memory). Logic must be INLINED inside
// each callback. We accept the duplication.

onRecordAfterCreateRequest((e) => {
  const record = e.record;

  // Only fire for pending users (role empty). Admin-created users with a pre-set role skip.
  const role = record.getString("role");
  if (role && role !== "") return;

  try {
    function esc(s) {
      if (!s) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    const newUserId    = record.id;
    const newUserEmail = record.getString("email");
    const newUserName  = record.getString("name") || "(no name)";
    const createdAt    = record.getString("created");

    const baseUrl   = $os.getenv("APP_BASE_URL") || "http://localhost:5173";
    const reviewUrl = baseUrl + "/users";

    const htmlBody =
      "<h2>New user signup awaiting approval</h2>" +
      "<p>A new user just signed up and is awaiting role assignment:</p>" +
      "<ul>" +
        "<li><b>Email:</b> "     + esc(newUserEmail) + "</li>" +
        "<li><b>Name:</b> "      + esc(newUserName)  + "</li>" +
        "<li><b>Signed up:</b> " + esc(createdAt)    + "</li>" +
      "</ul>" +
      "<p><a href='" + esc(reviewUrl) + "'>Review and assign role &rarr;</a></p>";

    const subject = "Kit Tracker: new user awaiting approval (" + esc(newUserEmail) + ")";

    let admins = [];
    try {
      admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
    } catch (queryErr) {
      console.log("[user_signup_notify create] Failed to query admins:", queryErr);
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
    } catch (err) {
      console.log("[user_signup_notify create] on-call lookup failed:", err);
    }

    const recipientsMap = {};
    for (let i = 0; i < admins.length; i++) {
      recipientsMap[admins[i].id] = admins[i];
    }
    for (let i = 0; i < onCallShifts.length; i++) {
      try {
        const u    = $app.dao().findRecordById("users", onCallShifts[i].getString("user"));
        const r    = u.getString("role");
        if (r === "admin" || r === "technician") {
          recipientsMap[u.id] = u;
        }
      } catch (err) { /* skip missing user */ }
    }

    const senderAddress = $app.settings().meta?.senderAddress || ($os.getenv("SMTP_FROM") || "notifications@kit.local");
    const senderName    = $app.settings().meta?.senderName    || "Kit Tracker";
    const recipientIds  = Object.keys(recipientsMap);

    for (let i = 0; i < recipientIds.length; i++) {
      const recipient      = recipientsMap[recipientIds[i]];
      if (recipient.id === newUserId) continue;
      const recipientEmail = recipient.getString("email");
      const recipientName  = recipient.getString("name") || recipientEmail;
      if (!recipientEmail) continue;

      try {
        const message = new MailerMessage({
          from: { address: senderAddress, name: senderName },
          to: [{ address: recipientEmail, name: recipientName }],
          subject: subject,
          html:    htmlBody,
        });
        $app.newMailClient().send(message);
        console.log("[user_signup_notify create] Notified:", recipientEmail);
      } catch (mailErr) {
        const msg = String(mailErr);
        if (msg.indexOf("smtp") !== -1 || msg.indexOf("SMTP") !== -1 || msg.indexOf("dial") !== -1) {
          console.log("[user_signup_notify create] smtp not configured, skipping notification for:", recipientEmail);
        } else {
          console.log("[user_signup_notify create] Failed to send to " + recipientEmail + ":", mailErr);
        }
      }
    }
  } catch (outerErr) {
    console.log("[user_signup_notify create] hook failed:", outerErr);
  }
}, "users");

onRecordAfterAuthWithOAuth2Request((e) => {
  if (e.isNewRecord !== true) return;
  const record = e.record;

  const role = record.getString("role");
  if (role && role !== "") return;

  try {
    function esc(s) {
      if (!s) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    const newUserId    = record.id;
    const newUserEmail = record.getString("email");
    const newUserName  = record.getString("name") || "(no name)";
    const createdAt    = record.getString("created");

    const baseUrl   = $os.getenv("APP_BASE_URL") || "http://localhost:5173";
    const reviewUrl = baseUrl + "/users";

    const htmlBody =
      "<h2>New user signup awaiting approval (via Google)</h2>" +
      "<p>A new user just signed up via OAuth and is awaiting role assignment:</p>" +
      "<ul>" +
        "<li><b>Email:</b> "     + esc(newUserEmail) + "</li>" +
        "<li><b>Name:</b> "      + esc(newUserName)  + "</li>" +
        "<li><b>Signed up:</b> " + esc(createdAt)    + "</li>" +
      "</ul>" +
      "<p><a href='" + esc(reviewUrl) + "'>Review and assign role &rarr;</a></p>";

    const subject = "Kit Tracker: new user awaiting approval (" + esc(newUserEmail) + ")";

    let admins = [];
    try {
      admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
    } catch (queryErr) {
      console.log("[user_signup_notify oauth] Failed to query admins:", queryErr);
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
    } catch (err) {
      console.log("[user_signup_notify oauth] on-call lookup failed:", err);
    }

    const recipientsMap = {};
    for (let i = 0; i < admins.length; i++) {
      recipientsMap[admins[i].id] = admins[i];
    }
    for (let i = 0; i < onCallShifts.length; i++) {
      try {
        const u    = $app.dao().findRecordById("users", onCallShifts[i].getString("user"));
        const r    = u.getString("role");
        if (r === "admin" || r === "technician") {
          recipientsMap[u.id] = u;
        }
      } catch (err) { /* skip missing user */ }
    }

    const senderAddress = $app.settings().meta?.senderAddress || ($os.getenv("SMTP_FROM") || "notifications@kit.local");
    const senderName    = $app.settings().meta?.senderName    || "Kit Tracker";
    const recipientIds  = Object.keys(recipientsMap);

    for (let i = 0; i < recipientIds.length; i++) {
      const recipient      = recipientsMap[recipientIds[i]];
      if (recipient.id === newUserId) continue;
      const recipientEmail = recipient.getString("email");
      const recipientName  = recipient.getString("name") || recipientEmail;
      if (!recipientEmail) continue;

      try {
        const message = new MailerMessage({
          from: { address: senderAddress, name: senderName },
          to: [{ address: recipientEmail, name: recipientName }],
          subject: subject,
          html:    htmlBody,
        });
        $app.newMailClient().send(message);
        console.log("[user_signup_notify oauth] Notified:", recipientEmail);
      } catch (mailErr) {
        const msg = String(mailErr);
        if (msg.indexOf("smtp") !== -1 || msg.indexOf("SMTP") !== -1 || msg.indexOf("dial") !== -1) {
          console.log("[user_signup_notify oauth] smtp not configured, skipping notification for:", recipientEmail);
        } else {
          console.log("[user_signup_notify oauth] Failed to send to " + recipientEmail + ":", mailErr);
        }
      }
    }
  } catch (outerErr) {
    console.log("[user_signup_notify oauth] hook failed:", outerErr);
  }
}, "users");
