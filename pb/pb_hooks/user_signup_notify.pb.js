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
// Both paths call the same inlined notify(record) closure below.

function _userSignupNotify_run(record) {
  // Only fire for pending users (role empty). Admin-created users with a pre-set role skip.
  const role = record.getString("role");
  if (role && role !== "") return;

  try {
    // Tiny HTML escape — user-controlled strings go into the email body.
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

    // APP_BASE_URL env var; default to localhost dev URL.
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

    // Build recipient list: all admins + current on-call (deduped by id, skip new user themselves).
    let admins = [];
    try {
      admins = $app.dao().findRecordsByFilter("users", "role = 'admin'", "", 100, 0);
    } catch (queryErr) {
      console.log("[user_signup_notify] Failed to query admins:", queryErr);
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
      console.log("[user_signup_notify] on-call lookup failed:", e);
    }

    // Combine admins + on-call users, deduped by id.
    const recipientsMap = {};
    for (let i = 0; i < admins.length; i++) {
      recipientsMap[admins[i].id] = admins[i];
    }
    for (let i = 0; i < onCallShifts.length; i++) {
      try {
        const u    = $app.dao().findRecordById("users", onCallShifts[i].getString("user"));
        const role = u.getString("role");
        if (role === "admin" || role === "technician") {
          recipientsMap[u.id] = u;
        }
      } catch (e) { /* skip missing user */ }
    }

    const senderAddress = $app.settings().meta?.senderAddress || ($os.getenv("SMTP_FROM") || "notifications@kit.local");
    const senderName    = $app.settings().meta?.senderName    || "Kit Tracker";
    const recipientIds  = Object.keys(recipientsMap);

    for (let i = 0; i < recipientIds.length; i++) {
      const recipient      = recipientsMap[recipientIds[i]];
      // Don't email the new user themselves (edge: if new signup happens to share an admin id — shouldn't happen, but guard anyway).
      if (recipient.id === newUserId) continue;
      const recipientEmail = recipient.getString("email");
      const recipientName  = recipient.getString("name") || recipientEmail;
      if (!recipientEmail) continue;

      try {
        const message = new MailerMessage({
          from: {
            address: senderAddress,
            name:    senderName,
          },
          to: [{ address: recipientEmail, name: recipientName }],
          subject: subject,
          html:    htmlBody,
        });
        $app.newMailClient().send(message);
        console.log("[user_signup_notify] Notified:", recipientEmail);
      } catch (mailErr) {
        // Likely smtp not configured; log and continue so remaining recipients still receive.
        const msg = String(mailErr);
        if (msg.indexOf("smtp") !== -1 || msg.indexOf("SMTP") !== -1 || msg.indexOf("dial") !== -1) {
          console.log("[user_signup_notify] smtp not configured, skipping notification for:", recipientEmail);
        } else {
          console.log("[user_signup_notify] Failed to send to " + recipientEmail + ":", mailErr);
        }
      }
    }
  } catch (outerErr) {
    console.log("[user_signup_notify] hook failed:", outerErr);
  }
}

// Path 1: email/password signup via HTTP create.
onRecordAfterCreateRequest((e) => {
  _userSignupNotify_run(e.record);
}, "users");

// Path 2: OAuth signup (Google). Hook fires on EVERY OAuth auth — gate on isNewRecord
// so only the first sign-in (when PB created the user record) triggers the notification.
onRecordAfterAuthWithOAuth2Request((e) => {
  if (e.isNewRecord !== true) return;
  _userSignupNotify_run(e.record);
}, "users");
